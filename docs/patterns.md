# Patterns / Textures

The **Patterns** tab builds editable mathematically defined 3-axis engraving
toolpaths. **Prepare → Operations → Add operation → Pattern / Texture** adds a
parameterised operation, which you edit with the **Edit pattern and toolpath**
button or by double-clicking the operation in the Plates tree.

In **Patterns**, choose any of the ten watch-dial recipes or enter formulae
for `x(t,i)`, `y(t,i)`, `z(t,i)`. `t` is the curve parameter from
`tMin` to `tMax`, `i` is the zero-based path number, `n` is the
total number of paths, `pi` and `tau` are constants. Add named numerical
parameters to turn them into sliders. The formulas are evaluated in a
restricted mathematical environment: arbitrary JavaScript execution is not
available.

The available presets are **Guilloché rosette, concentric rings, sunburst,
turbine, Archimedean spirals, Flinqué waves, basketweave, Clous de Paris,
perlage and Grain d'orge**. They are engraving _paths_, not solid-model
pockets or a simulated rose-engine cutter. Tool radius and actual decorative
groove geometry depend on the installed cutter.

The SVG preview shows the XY projection of the sampled vector paths. Copy
or download the generated G-code. In a Pattern operation, **Apply toolpath**
saves the mathematical recipe and the current generated NC to the plate.
The operation then compiles with OpenSpindle's existing G-code validation and
appears in its Prepare and Job viewers. Open the collapsed
**OpenSpindle 3D machine and stock viewer** below the editor to see the
actual 3D preview of the saved operation. The editing preview itself is 2D;
it is not a stock-removal simulation.

## Standalone

The engine in `patterns/engine` is a small Rust crate. Native usage:

```bash
cargo run --manifest-path patterns/engine/Cargo.toml --release < specification.json
```

The command prints a JSON object containing sampled 3D vectors, G-code,
bounding box and number of points. To compile the browser WASM module:

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-pack
npm run patterns:wasm
```

Then run `npm run patterns:dev` for the standalone web editor, or
`npm run patterns:build` to build `dist-patterns/standalone.html`.
When the WASM artifact was not built, the editor uses its local JavaScript
mathematical fallback, visibly labelled **Local preview**. The Rust and
JavaScript engines produce the same path data structure. Supported functions are
`sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `sqrt`, `abs`, `floor`, `ceil`,
`exp`, `ln` (natural logarithm), `log` (base 10), `pow`, `min` and `max`.
Powers bind before unary minus: `-2^2` means `-(2^2)`.
Errors from an available Rust engine appear in the editor. Export and Apply
remain disabled until the current inputs have finished generating, so an
edited recipe cannot be saved with an older toolpath.

## Machining and safety

A pattern assumes work-coordinate `Z0` is the prepared stock surface.
Engraving depth is limited to -3..0 mm. Every separate curve starts with a
safe-Z retract and XY rapid before plunging. Generation, saving, importing,
and previewing do **not** move any machine. The generator cannot verify the
physical clearances of the Z1, including the toolsetter, stock or fixtures.
Before Run, ensure the chosen tool number and library cutter, work origin,
stock dimensions and safe Z agree with the setup. Review existing OpenSpindle
diagnostics, and verify simulation and the machine's tool-length probe.

Use conservative feed and plunge values until the cut is verified on scrap.
Machine operation is always an explicit action from the Job tab.
