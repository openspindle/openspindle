//! Standalone Rust + WASM mathematical engraving engine. No machine I/O.
//! The output is an editable vector path intermediate representation and preview NC.
//! Review setup, clearance, tool, stock and fixtures in the host before machining.

use serde::{Deserialize, Serialize};
use meval::{Context, Expr};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Parameter {
    pub name: String,
    pub value: f64,
    pub min: f64,
    pub max: f64,
    pub step: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Spec {
    pub x: String,
    pub y: String,
    pub z: String,
    pub t_min: f64,
    pub t_max: f64,
    pub samples: usize,
    pub paths: usize,
    pub parameters: Vec<Parameter>,
    pub safe_z: f64,
    pub feed: f64,
    pub plunge: f64,
    pub rpm: u32,
    pub tool: u32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Toolpath {
    pub paths: Vec<Vec<[f64; 3]>>,
    pub gcode: String,
    pub min: [f64; 3],
    pub max: [f64; 3],
    pub points: usize,
}

fn valid(value: f64, field: &str) -> Result<f64, String> {
    if !value.is_finite() { return Err(format!("{field} must be finite")); }
    Ok(value)
}

fn expression(input: &str, axis: &str) -> Result<Expr, String> {
    input.parse().map_err(|e| format!("Invalid {axis} expression: {e}"))
}

fn eval(expr: &Expr, spec: &Spec, t: f64, i: usize) -> Result<f64, String> {
    let mut context = Context::empty();
    context.func("sin", f64::sin);
    context.func("cos", f64::cos);
    context.func("tan", f64::tan);
    context.func("asin", f64::asin);
    context.func("acos", f64::acos);
    context.func("atan", f64::atan);
    context.func("sqrt", f64::sqrt);
    context.func("abs", f64::abs);
    context.func("floor", f64::floor);
    context.func("ceil", f64::ceil);
    context.func("exp", f64::exp);
    context.func("ln", f64::ln);
    context.func("log", f64::log10);
    context.func2("pow", f64::powf);
    context.funcn("min", |args| args.iter().copied().fold(f64::INFINITY, f64::min), 1..);
    context.funcn("max", |args| args.iter().copied().fold(f64::NEG_INFINITY, f64::max), 1..);
    context.var("t", t);
    context.var("i", i as f64);
    context.var("n", spec.paths as f64);
    context.var("pi", std::f64::consts::PI);
    context.var("tau", std::f64::consts::TAU);
    for p in &spec.parameters { context.var(&p.name, p.value); }
    let value = expr.eval_with_context(&context).map_err(|e| e.to_string())?;
    valid(value, "Expression result")
}

fn number(v: f64) -> String { format!("{v:.4}") }

/// Generate bounded vectors in work coordinates, then serialise explicit safe retractions.
/// This does not assert physical machine clearance or collision-free cutter geometry.
pub fn build(spec: &Spec) -> Result<Toolpath, String> {
    if !(2..=2400).contains(&spec.samples) || !(1..=240).contains(&spec.paths)
        || spec.samples.saturating_mul(spec.paths) > 90_000 {
        return Err("Limit is 90,000 points, up to 2,400 samples and 240 paths".into());
    }
    if spec.parameters.len() > 32 { return Err("Maximum 32 parameters".into()); }
    if valid(spec.t_min, "tMin")? >= valid(spec.t_max, "tMax")?
        || spec.t_max - spec.t_min > 1000.0 {
        return Err("Invalid parameter interval".into());
    }
    if !(0.5..=100.0).contains(&spec.safe_z)
        || !(1.0..=10000.0).contains(&spec.feed)
        || !(1.0..=10000.0).contains(&spec.plunge)
        || !(1000..=40000).contains(&spec.rpm)
        || !(1..=999).contains(&spec.tool) {
        return Err("Invalid clearance, feeds, RPM or tool number".into());
    }
    let mut names = std::collections::HashSet::new();
    for p in &spec.parameters {
        if p.name.is_empty() || p.name.len() > 32
            || !p.name.chars().next().unwrap().is_ascii_alphabetic()
            || !p.name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
            || ["t", "i", "n", "pi", "tau"].contains(&p.name.as_str())
            || !names.insert(p.name.clone())
            || !p.value.is_finite() || !p.min.is_finite() || !p.max.is_finite()
            || !p.step.is_finite() || p.step <= 0.0
            || p.min > p.value || p.value > p.max {
            return Err(format!("Invalid slider: {}", p.name));
        }
    }
    let x = expression(&spec.x, "X")?;
    let y = expression(&spec.y, "Y")?;
    let z = expression(&spec.z, "Z")?;
    let mut paths = Vec::with_capacity(spec.paths);
    let mut min = [f64::INFINITY; 3];
    let mut max = [f64::NEG_INFINITY; 3];
    for i in 0..spec.paths {
        let mut path = Vec::with_capacity(spec.samples);
        for k in 0..spec.samples {
            let t = spec.t_min + (spec.t_max - spec.t_min) * k as f64 / (spec.samples - 1) as f64;
            let xyz = [eval(&x, spec, t, i)?, eval(&y, spec, t, i)?, eval(&z, spec, t, i)?];
            if xyz[0].abs() > 300.0 || xyz[1].abs() > 300.0 || xyz[2] < -3.0 || xyz[2] > 0.0 {
                return Err("Pattern exceeds ±300 mm XY or the -3…0 mm engraving depth range".into());
            }
            for axis in 0..3 {
                min[axis] = min[axis].min(xyz[axis]);
                max[axis] = max[axis].max(xyz[axis]);
            }
            path.push(xyz);
        }
        paths.push(path);
    }
    // No rapid XY while below safe Z; all linked curves are raised first.
    let mut nc = vec![
        "(Parametric engraving; verify stock top Z0, cutter and clearances)".to_string(),
        "G21 G90 G17 G94".into(),
        format!("T{} M6", spec.tool),
        format!("S{} M3", spec.rpm),
        format!("G0 Z{}", number(spec.safe_z)),
    ];
    for path in &paths {
        let first = path[0];
        nc.push(format!("G0 X{} Y{}", number(first[0]), number(first[1])));
        nc.push(format!("G1 Z{} F{}", number(first[2]), number(spec.plunge)));
        for &point in path.iter().skip(1) {
            nc.push(format!("G1 X{} Y{} Z{} F{}", number(point[0]), number(point[1]), number(point[2]), number(spec.feed)));
        }
        nc.push(format!("G0 Z{}", number(spec.safe_z)));
    }
    nc.push("M5".into());
    nc.push("M30".into());
    Ok(Toolpath { points: spec.samples * spec.paths, paths, gcode: nc.join("\n"), min, max })
}

/// JSON ABI is shared by native CLI, WASM and the TypeScript editor.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen::prelude::wasm_bindgen)]
pub fn generate_pattern(request: &str) -> Result<String, String> {
    let spec: Spec = serde_json::from_str(request).map_err(|e| e.to_string())?;
    let out = build(&spec)?;
    serde_json::to_string(&out).map_err(|e| e.to_string())
}
