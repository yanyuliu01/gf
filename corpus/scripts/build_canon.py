# -*- coding: utf-8 -*-
"""A9 管线 · 步骤3-5 前置：应用视角标注 + 按源清洗 → canon 三表 JSONL
输出 canon/canon_self.jsonl, canon_known.jsonl, canon_world.jsonl, stats.md
"""
import hashlib, json, os, re, glob, sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW, WORK, CANON = (os.path.join(ROOT, d) for d in ("raw", "work", "canon"))
os.makedirs(CANON, exist_ok=True)

chunks = [json.loads(l) for l in open(os.path.join(WORK, "chunks.jsonl"), encoding="utf-8")]
labels = json.load(open(os.path.join(WORK, "labels.json"), encoding="utf-8"))["files"]

MLYSS = ("缪尔赛思", "缪缪")
PAREN_UTT = re.compile(r"^[^：]{1,16}：（[^（）]*）$")
UNRESOLVED_ROLE_MARKER = re.compile(r"【(?:博士选项|分支(?:·[^】]*)?)】")
DISPLAY_MARKER = re.compile(r"【画面文字】")


def stable_id(prefix, entry):
    """Build a content-addressed ID independent of global output ordering."""
    identity = [
        entry.get("label"), entry.get("kind"), entry.get("work"),
        entry.get("file"), entry.get("node"), entry.get("text"),
    ]
    payload = json.dumps(identity, ensure_ascii=False, separators=(",", ":"))
    return f"{prefix}_{hashlib.sha256(payload.encode('utf-8')).hexdigest()[:16]}"


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def validate_labels(all_chunks, file_labels):
    """Fail closed on stale, overlapping, malformed, or cross-platform labels."""
    seqs_by_file = defaultdict(set)
    for chunk in all_chunks:
        file_name, seq = chunk.get("file"), chunk.get("seq")
        if not isinstance(file_name, str) or not isinstance(seq, int):
            raise ValueError(f"invalid chunk identity: {chunk!r}")
        if seq in seqs_by_file[file_name]:
            raise ValueError(f"duplicate chunk seq {file_name}#{seq}")
        seqs_by_file[file_name].add(seq)

    for file_name, seqs in seqs_by_file.items():
        expected = set(range(max(seqs) + 1))
        if seqs != expected:
            raise ValueError(f"non-contiguous chunk seqs for {file_name}")

    allowed_keys = {"default", "self", "known", "world"}
    for file_name, rule in file_labels.items():
        if file_name not in seqs_by_file:
            raise ValueError(f"label references missing file: {file_name}")
        if not isinstance(rule, dict):
            raise ValueError(f"label rule must be object: {file_name}")
        unknown = set(rule) - allowed_keys
        if unknown:
            raise ValueError(f"unknown label keys for {file_name}: {sorted(unknown)}")
        if rule.get("default", "world") not in {"self", "known", "world"}:
            raise ValueError(f"invalid default label for {file_name}")

        max_seq = max(seqs_by_file[file_name])
        covered = {}
        for label in ("self", "known", "world"):
            ranges = rule.get(label, [])
            if not isinstance(ranges, list):
                raise ValueError(f"{file_name}.{label} must be a list")
            for span in ranges:
                if (
                    not isinstance(span, list) or len(span) != 2
                    or not all(isinstance(n, int) and not isinstance(n, bool) for n in span)
                ):
                    raise ValueError(f"malformed range {file_name}.{label}: {span!r}")
                start, end = span
                if start < 0 or start > end or end > max_seq:
                    raise ValueError(
                        f"out-of-range label {file_name}.{label}: {span!r}; max={max_seq}"
                    )
                for seq in range(start, end + 1):
                    if seq in covered:
                        raise ValueError(
                            f"overlapping labels for {file_name}#{seq}: "
                            f"{covered[seq]} and {label}"
                        )
                    covered[seq] = label


def add_runtime_safety(entry):
    """Keep research text intact while exposing only role-safe runtime text."""
    unresolved = sorted(set(UNRESOLVED_ROLE_MARKER.findall(entry["text"])))
    if unresolved:
        entry["runtime_safe"] = False
        entry["role_safe_text"] = None
        entry["role_safe_chars"] = 0
        entry["unsafe_reasons"] = ["unresolved_doctor_choice_or_branch"]
        entry["unsafe_markers"] = unresolved
        return

    role_safe_text = DISPLAY_MARKER.sub("", entry["text"]).strip()
    entry["runtime_safe"] = True
    entry["role_safe_text"] = role_safe_text
    entry["role_safe_chars"] = len(role_safe_text.replace("\n", ""))


validate_labels(chunks, labels)

def label_of(c):
    rule = labels.get(c["file"])
    if not rule:
        return "world"
    for lab in ("self", "known", "world"):
        for a, b in rule.get(lab, []):
            if a <= c["seq"] <= b:
                return lab
    return rule.get("default", "world")

def clean_self_text(text):
    """canon_self 中剔除他人的全括号内心独白（她听不见的想法）"""
    out = []
    for line in text.split("\n"):
        if PAREN_UTT.match(line.strip()):
            spk = line.split("：", 1)[0]
            if not any(m in spk for m in MLYSS):
                continue
        out.append(line)
    return "\n".join(out)

entries = {"self": [], "known": [], "world": []}

for c in chunks:
    lab = label_of(c)
    kind = ("memory" if "memory-干员密录" in c["file"]
            else "module" if "模组故事" in c["file"]
            else "story")
    text = clean_self_text(c["text"]) if lab == "self" else c["text"]
    e = {"label": f"canon_{lab}", "kind": kind, "work": c["work"], "file": c["file"],
         "node": c["node"], "seq": c["seq"], "text": text,
         "chars": len(text.replace("\n", "")), "speakers": c["speakers"],
         "source_chunk_id": c["id"]}
    if "obt-rogue" in c["file"]:
        e["hypothetical"] = True
        e["note"] = "集成战略假想语境，不作既定事实"
    if lab == "known" and "孤岛风云" in c["file"]:
        e["note"] = "转述：酒吧复盘中被讲给她听的曼斯菲尔德越狱事件"
    entries[lab].append(e)

# ---- 语音记录 → canon_self (kind=voice) ----
BATTLE = re.compile(r"部署|选中|作战中|行动出发|行动开始|行动失败|结束行动|完成高难行动|观看作战记录|编入队伍|任命队长|^标题$")
vp = os.path.join(RAW, "muelsyse", "语音记录.md")
txt = open(vp, encoding="utf-8").read()
vcats = Counter(); vkept = 0
for m in re.finditer(r"^## (.+?)\n+(.+?)(?=\n## |\Z)", txt, flags=re.M | re.S):
    cat, body = m.group(1).strip(), m.group(2).strip().replace("\n", " ")
    vcats[cat] += 1
    if BATTLE.search(cat):
        continue
    vkept += 1
    entries["self"].append({"label": "canon_self", "kind": "voice", "work": "语音记录",
                            "file": "muelsyse/语音记录.md", "node": cat, "seq": vkept - 1,
                            "text": body, "chars": len(body), "speakers": ["缪尔赛思"]})

# ---- 档案 → canon_world (kind=archive)：按节切，超长再按段落切 ----
def archive_entries(path, work, person):
    txt = open(path, encoding="utf-8").read()
    out = []
    for m in re.finditer(r"^## (.+?)\n+(.+?)(?=\n## |\Z)", txt, flags=re.M | re.S):
        sec, body = m.group(1).strip(), m.group(2).strip()
        paras = [p for p in body.split("\n") if p.strip()]
        cur, cur_len = [], 0
        segs = []
        for p in paras:
            if cur and cur_len + len(p) > 500:
                segs.append("\n".join(cur)); cur, cur_len = [], 0
            cur.append(p); cur_len += len(p)
        if cur:
            segs.append("\n".join(cur))
        for i, s in enumerate(segs):
            node = sec if len(segs) == 1 else f"{sec}·{i+1}"
            out.append({"label": "canon_world", "kind": "archive", "work": work,
                        "file": os.path.relpath(path, RAW).replace("\\", "/"),
                        "node": node, "seq": len(out), "text": s,
                        "chars": len(s.replace("\n", "")), "speakers": [],
                        "person": person,
                        "note": "第三方视角档案原文，仅供引擎侧参考，绝不作为她的记忆"})
    return out

entries["world"] += archive_entries(os.path.join(RAW, "muelsyse", "干员档案.md"), "干员档案", "缪尔赛思")
for p in sorted(glob.glob(os.path.join(RAW, "worldview", "莱茵生命相关干员档案", "*.md"))):
    person = os.path.splitext(os.path.basename(p))[0]
    entries["world"] += archive_entries(p, "干员档案", person)
# 势力代号表：整表一条参考
ft = open(os.path.join(RAW, "worldview", "势力代号表.md"), encoding="utf-8").read()
body = ft.split("---", 2)[-1].strip()
entries["world"].append({"label": "canon_world", "kind": "reference", "work": "势力代号表",
                        "file": "worldview/势力代号表.md", "node": "全表", "seq": 0,
                        "text": body, "chars": len(body), "speakers": [],
                        "note": "引擎侧势力名称对照参考"})

# ---- 她本人档案内的第一人称口述（“……”整段引文）→ canon_self ----
# 依据 docs/05 §A9.4：档案原文不作她的记忆——但档案资料三【语音记录】与晋升记录中的
# 引号段是她自己的话（口述实录），按源属于语音类 → canon_self。验收样例（初见克丽斯腾）依赖此。
atxt = open(os.path.join(RAW, "muelsyse", "干员档案.md"), encoding="utf-8").read()
qn = 0
for sec_name in ("档案资料三", "晋升记录"):
    m = re.search(rf"^## {sec_name}\n+(.+?)(?=\n## |\Z)", atxt, flags=re.M | re.S)
    if not m:
        continue
    block = m.group(1)
    for qm in re.finditer(r"((?:^“[^\n]+\n?)+)", block, flags=re.M):
        quote = qm.group(1).strip()
        if len(quote) < 30:
            continue
        entries["self"].append({"label": "canon_self", "kind": "archive_quote",
                                "work": "干员档案", "file": "muelsyse/干员档案.md",
                                "node": f"{sec_name}·口述", "seq": qn, "text": quote,
                                "chars": len(quote.replace(chr(10), "")), "speakers": ["缪尔赛思"],
                                "note": "档案中她本人的第一人称口述引文，按源归语音类"})
        qn += 1

# ---- 蒸馏事实条目（人工撰写，随脚本数据文件注入） ----
facts_path = os.path.join(WORK, "facts.jsonl")
n_facts = 0
if os.path.exists(facts_path):
    for l in open(facts_path, encoding="utf-8"):
        if l.strip():
            f = json.loads(l)
            f.setdefault("label", "canon_world"); f.setdefault("kind", "fact")
            f.setdefault("speakers", []); f.setdefault("chars", len(f["text"]))
            entries["world"].append(f); n_facts += 1

# ---- 运行时清洗 + 稳定 ID + 写出 ----
written_entries = {"self": [], "known": [], "world": []}
seen_ids = {}
for lab, prefix in (("self", "cs"), ("known", "ck"), ("world", "cw")):
    for raw_entry in entries[lab]:
        entry = {key: value for key, value in raw_entry.items() if key != "id"}
        add_runtime_safety(entry)
        entry_id = stable_id(prefix, entry)
        if entry_id in seen_ids:
            raise RuntimeError(
                f"stable canon id collision: {entry_id} for "
                f"{seen_ids[entry_id]!r} and {entry.get('file')!r}"
            )
        seen_ids[entry_id] = entry.get("file")
        written_entries[lab].append({"id": entry_id, **entry})

    output_path = os.path.join(CANON, f"canon_{lab}.jsonl")
    with open(output_path, "w", encoding="utf-8", newline="\n") as handle:
        for entry in written_entries[lab]:
            handle.write(json.dumps(entry, ensure_ascii=False, separators=(",", ":")) + "\n")

# ---- 统计 ----
lines = ["# canon 语料库统计", ""]
for lab in ("self", "known", "world"):
    es = written_entries[lab]
    kinds = Counter(e["kind"] for e in es)
    works = Counter(e["work"] for e in es)
    tot = sum(e["chars"] for e in es)
    n_safe = sum(1 for e in es if e["runtime_safe"])
    lines.append(f"## canon_{lab}: {len(es)} 条 / {tot//1000}k 字")
    lines.append("kind: " + ", ".join(f"{k}={v}" for k, v in kinds.most_common()))
    lines.append("work: " + ", ".join(f"{k}={v}" for k, v in works.most_common(12)))
    lines.append(f"runtime-safe: {n_safe}; quarantined: {len(es) - n_safe}")
    lines.append("")
lines.append(f"语音类别({sum(vcats.values())}→保留{vkept}): " + ", ".join(f"{k}×{v}" for k, v in vcats.most_common()))
lines.append(f"蒸馏事实条目: {n_facts}")
stats_path = os.path.join(CANON, "stats.md")
with open(stats_path, "w", encoding="utf-8", newline="\n") as handle:
    handle.write("\n".join(lines) + "\n")

# ---- 可复现构建清单 ----
input_files = {
    "chunks": os.path.join(WORK, "chunks.jsonl"),
    "labels": os.path.join(WORK, "labels.json"),
    "facts": facts_path,
    "chunk_script": os.path.join(ROOT, "scripts", "chunk.py"),
    "canon_script": os.path.join(ROOT, "scripts", "build_canon.py"),
    "source_manifest": os.path.join(ROOT, "source-manifest.json"),
}
inputs = {}
for name, path in input_files.items():
    if os.path.exists(path):
        inputs[name] = {
            "path": os.path.relpath(path, ROOT).replace("\\", "/"),
            "sha256": sha256_file(path),
        }

output_files = {
    lab: os.path.join(CANON, f"canon_{lab}.jsonl")
    for lab in ("self", "known", "world")
}
output_files["stats"] = stats_path
outputs = {}
for name, path in output_files.items():
    item = {
        "path": os.path.relpath(path, ROOT).replace("\\", "/"),
        "sha256": sha256_file(path),
    }
    if name in written_entries:
        item["entries"] = len(written_entries[name])
        item["runtime_safe"] = sum(
            1 for entry in written_entries[name] if entry["runtime_safe"]
        )
    outputs[name] = item

source_manifest_path = os.path.join(ROOT, "source-manifest.json")
source_snapshot = None
if os.path.exists(source_manifest_path):
    with open(source_manifest_path, encoding="utf-8") as handle:
        source_snapshot = json.load(handle)

manifest = {
    "schema_version": "1.0",
    "build_contract_version": "2",
    "id_strategy": "prefix + sha256(label,kind,work,file,node,text)[0:16]",
    "runtime_text_contract": (
        "only entries with runtime_safe=true and non-null role_safe_text may enter role context"
    ),
    "source_snapshot": source_snapshot,
    "inputs": inputs,
    "outputs": outputs,
}
with open(os.path.join(CANON, "manifest.json"), "w", encoding="utf-8", newline="\n") as handle:
    json.dump(manifest, handle, ensure_ascii=False, indent=2, sort_keys=True)
    handle.write("\n")
print("\n".join(lines))
