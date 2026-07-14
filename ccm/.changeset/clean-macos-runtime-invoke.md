---
'ccm': patch
---

Replace executable fd pseudo-path spawning with explicit platform assurance tiers: Linux keeps build-attested exact-fd execution, while macOS uses a build-attested final pathname identity/revision/digest check, advertises the remaining same-UID race, and rejects strict exact-object callers before spawning.
