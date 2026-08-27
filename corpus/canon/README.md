# canon 派生产物契约

三张 JSONL 是研究语料与运行时检索的共同派生物，但两个用途必须分开：

- `text`：保留加工后的研究原文，可能仍含博士选项或剧情分支标签；不得直接装入角色上下文。
- `runtime_safe`：只有严格等于 `true` 才允许进入运行时检索候选。
- `role_safe_text`：运行时唯一可装配文本。含未解析博士选项/分支的整条记录会被 fail-closed 隔离并置为 `null`。
- `source_chunk_id`：指回 `work/chunks.jsonl` 的稳定内容 ID（非 chunk 来源条目可无此字段）。
- `id`：内容寻址稳定 ID，不再使用随全库插入而漂移的全局顺序号。

`manifest.json` 记录输入/输出哈希、ID 策略、上游快照披露、条目数和安全条目数。每次修改 raw、labels、facts 或构建脚本后必须依次运行：

## Manifest 哈希字节契约

`manifest.json` 中所有输入和输出的 SHA-256 均调用 `scripts/canonical_bytes.py`。哈希前只规范换行字节：CRLF 与单独 CR 转成 LF；BOM、Unicode 编码字节、空白和末尾是否有换行均保持原样并参与哈希。这项规范只生成跨平台校验字节，不改写文件、canon 正文或稳定内容 ID。

构建与审计必须共同导入该函数；manifest 的 `hash_contract` 必须与函数公开的契约一致。仅因 Git checkout 改变 LF/CRLF 时，既有 manifest 应继续通过审计，无需重新生成。

完成条件：共享函数的 LF/CRLF/CR 测试通过，当前 manifest 的每个输入和输出在 LF 与 CRLF 变体下得到相同记录哈希，完整 canon audit 通过。

## 构建与审计

```text
python scripts/chunk.py
python scripts/build_canon.py
python scripts/audit_canon.py
```

若 `audit_canon.py` 失败，不得发布或继续向量化。
