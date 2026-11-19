//! Native standalone generator: cat specification.json | cargo run --release --manifest-path patterns/engine/Cargo.toml
use std::io::{self, Read};
fn main() {
    let mut input = String::new();
    if let Err(err) = io::stdin().read_to_string(&mut input) {
        eprintln!("{err}");
        std::process::exit(1);
    }
    match openspindle_pattern_engine::generate_pattern(&input) {
        Ok(value) => println!("{value}"),
        Err(err) => {
            eprintln!("{err}");
            std::process::exit(1);
        }
    }
}
