---
"ccm": minor
"@ccm/engine": minor
---

新增 Goal Contract v1：fresh board 以 pending skeleton 启动，`ccm goal set|confirm|amend|show|check` 原子管理 normalized goal 与受管、不可变、可校验的 Goal Brief；contract 激活后禁止通用 `board update --goal` 绕过 revision 审计，并新增对应 lint/capability。
