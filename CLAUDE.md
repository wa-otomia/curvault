# 项目约定（CLAUDE.md）

## Git / 提交规范

**严禁**在 git commit message、PR 描述、代码注释中出现以下内容：

- `Co-Authored-By: Claude` 或任何 AI 协作者标记
- `🤖 Generated with [Claude Code]` 或任何 AI 工具生成标语
- `AI 协助开发`、`AI-assisted`、`with help of AI` 之类的措辞
- `Authored by GPT/Claude/Copilot/...` 等任何 AI 署名

所有提交以**自然人作者**身份撰写。commit message 风格保持简洁陈述句、动词开头。

## 技术栈

- **Tauri 2.x**（Rust 后端 + 系统 webview 前端）
- **React 18 + TypeScript 5**（前端）
- **Vite 5**（前端构建）
- 包管理：**pnpm** 优先（也接受 npm）
- 后端 Rust：edition 2021，stable toolchain

## 架构约束

- **前端不直接执行 shell**。所有 `gp` / `opensc-tool` / `pkcs15-init` 等调用必须通过 Tauri command 走 Rust 后端
- **后端按服务分层**：`src-tauri/src/services/{gp,opensc,pcsc,vault,profile}.rs`
- 每个服务对外暴露一组 `#[tauri::command]`，集中在 `commands.rs` 注册
- 前端通过 `src/lib/api.ts` 统一封装 `invoke()` 调用，组件层不直接 import `@tauri-apps/api`

## 安全约束

- GP key、PIN、PUK 等敏感数据**绝不**写明文到磁盘
- 必须通过 `services/vault.rs`（基于 `keyring` crate）存系统钥匙串
- 前端能拿到的是**句柄/别名**（如 `gp-key:card-abc123`），不是密钥本身
- 操作日志（issuance audit）只记元数据，不记密钥/PIN

## Tauri capabilities

- `tauri.conf.json` 默认 deny all
- `src-tauri/capabilities/default.json` 按需 allowlist
- 允许 `shell:execute`（限定 program 列表：gp/opensc-tool/pkcs15-init/openssl）
- 允许 `fs:read`（限定 CAP 文件路径选择）

## 代码风格

- TypeScript strict mode
- 单文件最长 400 行
- React 组件用函数式 + hooks
- Rust 用 `?` 错误传播，避免 unwrap
