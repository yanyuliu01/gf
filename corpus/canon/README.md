# canon 派生产物契约

三张 JSONL 是研究语料与运行时检索的共同派生物，但两个用途必须分开：

- `text`：保留加工后的研究原文，可能仍含博士选项或剧情分支标签；不得直接装入角色上下文。
- `runtime_safe`：只有严格等于 `true` 才允许进入运行时检索候选。
- `role_safe_text`：运行时唯一可装配文本。含未解析博士选项/分支的整条记录会被 fail-closed 隔离并置为 `null`。
- `source_chunk_id`：指回 `work/chunks.jsonl` 的稳定内容 ID（非 chunk 来源条目可无此字段）。
- `id`：内容寻址稳定 ID，不再使用随全库插入而漂移的全局顺序号。

`manifest.json` 记录输入/输出哈希、ID 策略、上游快照披露、条目数和安全条目数。每次修改 raw、labels、facts 或构建脚本后必须依次运行：

```text
python scripts/chunk.py
python scripts/build_canon.py
python scripts/audit_canon.py
```

若 `audit_canon.py` 失败，不得发布或继续向量化。
