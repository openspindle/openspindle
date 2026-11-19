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

The 3D preview uses the same orbit, pan, zoom and SpaceMouse navigation as
Prepare and Job. Use the view toolbar for top, front, perspective and fit.
**Line width** changes all preview strokes and each layer has its own colour.
The eye buttons hide layers in the toolpath preview. All layers still
participate in G-code generation and material removal.

Add another **Pattern** layer to combine independent formulae, sliders and
cutting settings. **Circle mask** protects a round area anywhere in XY.
**Dial numeral mask** places 1–12 in the selected local font on a ring.
These layers leave material uncut. The generator splits engraving strokes
at the mask and retracts across the gap. Set the mask clearance to at least
the maximum cutting radius engaged by your engraving tool, plus any extra
margin you want around the protected area.

Add **Circular cutout** to finish with an outside profile. Set the finished
radius, flat cutter diameter, measured stock thickness, step-down and tool
number. Its tool centre runs half the cutter diameter outside the part.
The pass that reaches stock thickness cuts the complete perimeter without
tabs. Secure the part independently and confirm clearance below the stock
before running it. Add extra depth only when the setup allows it. An
intersecting mask blocks generation of that cutout.

**Show removal** uses the same 3D scene and camera. It shows the result of
engraving with the preview V-bit (including its optional flat tip) and
cutting the perimeter with the specified flat cutter. The stock is virtual
and the displayed geometry is sampled.

In a Pattern operation, **Apply toolpath** saves the layer settings and
generated NC together. The standalone editor can copy or download the
combined G-code.

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
On the Makera Z1, compiling a Pattern operation adds a machine-coordinate
retract after tool change, moves to the middle of the machine with the spindle
off, and waits for that move to finish before starting the spindle. This also
applies to saved Pattern operations. The Job preflight checks setter clearance
against the Makera motion model, including tool changes and machine-coordinate
moves. Use the compiled job for the Z1 approach sequence. Standalone NC is
machine-independent.

Machine operation is always an explicit action from the Job tab.
