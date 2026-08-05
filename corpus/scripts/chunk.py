# -*- coding: utf-8 -*-
"""A9 管线 · 步骤2 切片
story/ 清洗版 + 模组故事 + 密录 → 200–500 字语义块（行边界对齐）。
输出:
  work/chunks.jsonl   每块: id, file, work, node, seq, text, chars, speakers,
                      mlyss_speak(她发言行数), mlyss_narr(旁白提及), mlyss_dial(他人对白提及)
  work/digest.md      按文件的段落摘要(在场/缺席分段), 供人工视角分拣
"""
import hashlib, json, os, re, sys, glob, unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "raw")
WORK = os.path.join(ROOT, "work")
os.makedirs(WORK, exist_ok=True)

TARGET_MIN, TARGET_MAX = 200, 500
BAN_IN_SPK = set("。，！、“”《》…—~ ")
MLYSS = ("缪尔赛思", "缪缪")


def stable_id(prefix, *parts):
    """Content-addressed IDs stay stable when unrelated files are inserted."""
    payload = json.dumps(parts, ensure_ascii=False, separators=(",", ":"))
    return f"{prefix}_{hashlib.sha256(payload.encode('utf-8')).hexdigest()[:16]}"

def parse_header(lines):
    meta, body_start = {}, 0
    if lines and lines[0].strip() == "---":
        for i in range(1, len(lines)):
            if lines[i].strip() == "---":
                body_start = i + 1
                break
            if ":" in lines[i]:
                k, v = lines[i].split(":", 1)
                meta[k.strip()] = v.strip()
    return meta, body_start

def classify(line):
    """返回 (kind, speaker)  kind: dlg|marker|narr"""
    s = line.strip()
    if not s:
        return None, None
    if s.startswith("【"):
        return "marker", None
    if "：" in s:
        spk = s.split("：", 1)[0]
        if 0 < len(spk) <= 16 and not (set(spk) & BAN_IN_SPK) and not spk.startswith("("):
            return "dlg", spk
    return "narr", None

def line_signals(kind, spk, s):
    speak = 1 if (kind == "dlg" and any(m in spk for m in MLYSS[:1])) else 0
    narr = 1 if (kind in ("narr", "marker") and any(m in s for m in MLYSS)) else 0
    dial = 0
    if kind == "dlg" and not speak:
        utt = s.split("：", 1)[1]
        dial = 1 if any(m in utt for m in MLYSS) else 0
    return speak, narr, dial

def chunk_file(path, work_name, rel):
    with open(path, encoding="utf-8") as f:
        lines = f.read().splitlines()
    meta, start = parse_header(lines)
    node = meta.get("节点", "") or meta.get("类型", "")
    chunks, cur, cur_len, cur_spk = [], [], 0, None
    def flush():
        nonlocal cur, cur_len
        if not cur:
            return
        text = "\n".join(x[2] for x in cur)
        spks, sp, na, di = [], 0, 0, 0
        for k, s_, raw in cur:
            a, b, c = line_signals(k, s_, raw)
            sp += a; na += b; di += c
            if k == "dlg" and s_ not in spks:
                spks.append(s_)
        chunks.append({"file": rel, "work": work_name, "node": node,
                       "seq": len(chunks), "text": text, "chars": len(text.replace("\n", "")),
                       "speakers": spks, "mlyss_speak": sp, "mlyss_narr": na, "mlyss_dial": di})
        cur, cur_len = [], 0
        return
    for line in lines[start:]:
        s = line.strip()
        if not s:
            continue
        kind, spk = classify(s)
        L = len(s)
        if cur_len >= TARGET_MIN:
            boundary = (kind == "narr") or (kind == "dlg" and spk != cur_spk)
            if boundary or cur_len + L > TARGET_MAX:
                flush()
        elif cur_len + L > TARGET_MAX and cur:
            flush()
        cur.append((kind, spk, s))
        cur_len += L
        if kind == "dlg":
            cur_spk = spk
    flush()
    return meta, chunks

def collect():
    jobs = []  # (path, work_name, rel)
    for act_dir in sorted(glob.glob(os.path.join(RAW, "story", "*"))):
        base = os.path.basename(act_dir)
        if not os.path.isdir(act_dir):
            continue
        for p in sorted(glob.glob(os.path.join(act_dir, "*.txt"))):
            rel = os.path.join(base, os.path.basename(p)).replace(os.sep, "/")
            jobs.append((p, base, rel))
    return jobs

def module_stories():
    """模组故事.md → 两则故事按段落切片(纯旁白, 无对白行)"""
    p = os.path.join(RAW, "muelsyse", "模组故事.md")
    out = []
    with open(p, encoding="utf-8") as f:
        txt = f.read()
    secs = re.split(r"^## ", txt, flags=re.M)[1:]
    for sec in secs:
        title = sec.splitlines()[0].strip()
        if "证章" in title:
            continue
        body = "\n".join(l for l in sec.splitlines()[1:] if l.strip())
        paras = [l.strip() for l in sec.splitlines()[1:] if l.strip()]
        cur, cur_len, seq = [], 0, 0
        name = re.sub(r"\(.*\)", "", title)
        for para in paras:
            if cur_len >= TARGET_MIN or (cur and cur_len + len(para) > TARGET_MAX):
                text = "\n".join(cur)
                out.append({"file": f"muelsyse/模组故事-{name}", "work": "模组故事", "node": name,
                            "seq": seq, "text": text, "chars": len(text.replace("\n", "")),
                            "speakers": [], "mlyss_speak": 0,
                            "mlyss_narr": sum(1 for l in cur if any(m in l for m in MLYSS)),
                            "mlyss_dial": 0})
                seq += 1; cur, cur_len = [], 0
            cur.append(para); cur_len += len(para)
        if cur:
            text = "\n".join(cur)
            out.append({"file": f"muelsyse/模组故事-{name}", "work": "模组故事", "node": name,
                        "seq": seq, "text": text, "chars": len(text.replace("\n", "")),
                        "speakers": [], "mlyss_speak": 0,
                        "mlyss_narr": sum(1 for l in cur if any(m in l for m in MLYSS)),
                        "mlyss_dial": 0})
    return out

def digest(all_chunks):
    """按文件把块聚成 在场/缺席 段落(空隙≤2 桥接), 生成审阅摘要"""
    from collections import OrderedDict
    by_file = OrderedDict()
    for c in all_chunks:
        by_file.setdefault(c["file"], []).append(c)
    lines = ["# 分拣审阅摘要（脚本信号，人工判定以此为线索、以文本为准）", ""]
    seg_rows = []
    for fn, cs in by_file.items():
        pres = [i for i, c in enumerate(cs) if c["mlyss_speak"] > 0 or c["mlyss_narr"] > 0]
        segs = []
        if pres:
            runs = [[pres[0], pres[0]]]
            for i in pres[1:]:
                if i - runs[-1][1] <= 3:
                    runs[-1][1] = i
                else:
                    runs.append([i, i])
        else:
            runs = []
        cursor = 0
        for a, b in runs:
            if cursor < a:
                segs.append((cursor, a - 1, "ABSENT"))
            segs.append((a, b, "PRESENT"))
            cursor = b + 1
        if cursor < len(cs):
            segs.append((cursor, len(cs) - 1, "ABSENT"))
        if not segs:
            segs = [(0, len(cs) - 1, "ABSENT")]
        total_speak = sum(c["mlyss_speak"] for c in cs)
        lines.append(f"## {fn}  ({len(cs)} 块, 她的台词 {total_speak} 行)")
        for a, b, st in segs:
            spks = []
            sp_cnt = sum(cs[i]["mlyss_speak"] for i in range(a, b + 1))
            na_cnt = sum(cs[i]["mlyss_narr"] for i in range(a, b + 1))
            di_cnt = sum(cs[i]["mlyss_dial"] for i in range(a, b + 1))
            for i in range(a, b + 1):
                for s in cs[i]["speakers"]:
                    if s not in spks:
                        spks.append(s)
            head = cs[a]["text"].replace("\n", " ")[:42]
            tail = cs[b]["text"].replace("\n", " ")[-30:]
            lines.append(f"- [{a}-{b}] {st} 说{sp_cnt}/旁{na_cnt}/被提{di_cnt} ｜ 说话人: {','.join(spks[:6])}")
            lines.append(f"    首「{head}」 尾「{tail}」")
            seg_rows.append({"file": fn, "a": a, "b": b, "signal": st})
        lines.append("")
    with open(os.path.join(WORK, "digest.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    with open(os.path.join(WORK, "segments.json"), "w", encoding="utf-8") as f:
        json.dump(seg_rows, f, ensure_ascii=False, indent=1)

def main():
    all_chunks = []
    for p, wk, rel in collect():
        _, cs = chunk_file(p, wk, rel)
        all_chunks.extend(cs)
    all_chunks.extend(module_stories())
    seen_ids = {}
    for c in all_chunks:
        chunk_id = stable_id("ch", c["file"], c["node"], c["text"])
        if chunk_id in seen_ids:
            raise RuntimeError(
                f"stable chunk id collision: {chunk_id} for "
                f"{seen_ids[chunk_id]!r} and {c['file']!r}"
            )
        seen_ids[chunk_id] = c["file"]
        c["id"] = chunk_id
    with open(os.path.join(WORK, "chunks.jsonl"), "w", encoding="utf-8") as f:
        for c in all_chunks:
            f.write(json.dumps(c, ensure_ascii=False) + "\n")
    digest(all_chunks)
    n = len(all_chunks)
    import statistics
    sizes = [c["chars"] for c in all_chunks]
    print(f"chunks={n} files={len(set(c['file'] for c in all_chunks))} "
          f"chars: min={min(sizes)} med={int(statistics.median(sizes))} max={max(sizes)} "
          f"<200:{sum(1 for s in sizes if s<200)} >500:{sum(1 for s in sizes if s>500)}")

if __name__ == "__main__":
    main()
