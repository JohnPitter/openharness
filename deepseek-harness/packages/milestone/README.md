# milestone/ — session milestone family

English | [中文](README.zh.md)

The model-facing milestone capability. It is a single **product** package because one agent session owns the append-only records; there is no replaceable provider contract.

| Package | Role | ctx key |
|---|---|---|
| [`tool-milestone/`](tool-milestone/README.md) | Records session milestones and publishes the titles-only index. | (registers on `ctx.tools`) |

The child README owns the tool, persistence, and rendering contract.
