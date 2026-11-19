# Patterns / Textures

The mathematical engraving engine is a standalone Rust crate. It samples three
parametric expressions `x(t,i)`, `y(t,i)`, `z(t,i)` into vector toolpaths and
outputs preview G-code. Variables `t`, `i` (path index), `n` (number of paths),
`pi` and `tau` are built in. Parameters are named slider values.

- Native standalone: `cat spec.json | cargo run --release --manifest-path patterns/engine/Cargo.toml`
- WASM: install Rust, the wasm32-unknown-unknown target and wasm-pack, then run
  `npm run patterns:wasm`. The build creates `public/pattern-wasm/`.
- Standalone UI: `npm run patterns:dev`, then open `/standalone.html`.
- Integrated UI: Add operation → Pattern / Texture, then open the Patterns tab.

The renderer can preview using an equivalent local evaluator until a WASM build
is present. A visible engine status identifies which one produced an NC export.
The Rust and renderer generator have the same bounds and path ordering.

Safety: output uses work-coordinate Z0 as surface and performs explicit
retracts before XY rapids. Neither the generator nor its preview proves the real
machine is clear of clamps, toolsetter, stock or other fixtures. Reconfirm
work offset, cutter, tool length and safe Z, inspect OpenSpindle's design rules,
simulate, and only then run. Editing and generating never move the machine.
