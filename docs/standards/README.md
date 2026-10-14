# Code standards

Each file holds one code pattern, written as rules. An agent follows them when it writes code. A reviewer checks a pull request against them. Each rule cites the plan section or the v1 lesson that it comes from.

| Standard                               | Covers                                                                      |
| -------------------------------------- | --------------------------------------------------------------------------- |
| [error-handling.md](error-handling.md) | Expected failures, `EvaError` codes, bad files, unawaited tasks, exit codes |
| [events.md](events.md)                 | The event union that crosses the engine port, and its ordering rules        |
| [file-layout.md](file-layout.md)       | The source layers, where a new file goes, and the test layout               |
| [naming.md](naming.md)                 | Names of files, types, functions, constants, codes, and tests               |
| [tests.md](tests.md)                   | Red-green, the named seams, fixtures, and the floors                        |

## Rules for this folder

- Keep one pattern per file. A new pattern gets a new file and a row in the table above.
- Write each rule so that a reviewer can check it in a diff.
- When the code and a standard disagree, fix the one that is wrong in the same pull request. Do not leave both.
- An architectural decision belongs in `adr/`, not here. A standard says how code looks; an ADR says why the system has its shape.
