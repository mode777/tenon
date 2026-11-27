# System architecture
Start with context and building blocks. Group large systems into subsystems; detail only areas with stakeholder concerns.

## Context
| Neighbour | Direction | Data / protocol |
|---|---|---|
| <system or user> | <in/out/both> | <interface> |

## Constraints
- <Binding constraint> — <reason or source>

## Building blocks
| Module | Responsibility | Depends on | Code / spec |
|---|---|---|---|
| <name> | <one line> | <modules> | `<path>` / `module-<name>.md` |

## Other concerns (optional)
- <Quality goal, strategy, flow, crosscutting rule or risk that matters to a stakeholder>

## Decisions (optional)
| Date | Decision | Why | Alternatives | Status |
|---|---|---|---|---|
| <date> | <choice> | <context and consequence> | <rejected options> | active |
