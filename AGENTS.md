# Ownership

- Atlas: scope, priorities, integration, acceptance.
- Nova: architecture and contracts.
- Pixel: Taste Engine `minimalism` experience with a Bento Grid layout (TRIDENT Robinhood Soft Bento).
- Forge: frontend.
- Nexus: backend and trading engine.
- Probe: independent verification.
- Sentinel: security and deployment gates.

# Guardrails

- Work from a dedicated issue branch after repository bootstrap.
- Do not edit another owner's branch or worktree.
- Keep live execution absent. Do not add signing or transaction-send code.
- Use integer base-unit strings for settlement amounts; never floating point.
- Validate external data at boundaries and keep strategy/risk logic deterministic.
- Preserve raw test evidence outside source control; report failed and unverified checks.

