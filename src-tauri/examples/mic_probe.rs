//! Dev tool: prints the default input device, its format and 3 s of RMS levels.
//! Run with `cargo run --example mic_probe`.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

fn main() {
    let host = cpal::default_host();
    println!("host: {:?}", host.id());
    for d in host.input_devices().into_iter().flatten() {
        println!("input device: {:?}", d.name());
    }
    let Some(device) = host.default_input_device() else {
        println!("no default input device");
        return;
    };
    println!("default: {:?}", device.name());
    let config = match device.default_input_config() {
        Ok(c) => c,
        Err(e) => {
            println!("default_input_config error: {e}");
            return;
        }
    };
    println!("config: {config:?}");
    let samples: Arc<Mutex<Vec<f32>>> = Arc::default();
    let sink = Arc::clone(&samples);
    let stream = device.build_input_stream(
        &config.config(),
        move |data: &[f32], _| {
            let rms = (data.iter().map(|v| v * v).sum::<f32>() / data.len().max(1) as f32).sqrt();
            if let Ok(mut s) = sink.lock() {
                s.push(rms);
            }
        },
        |e| println!("stream error: {e}"),
        None,
    );
    let stream = match stream {
        Ok(s) => s,
        Err(e) => {
            println!("build_input_stream error: {e}");
            return;
        }
    };
    if let Err(e) = stream.play() {
        println!("play error: {e}");
        return;
    }
    std::thread::sleep(Duration::from_secs(3));
    drop(stream);
    let s = samples.lock().map(|s| s.clone()).unwrap_or_default();
    let max = s.iter().cloned().fold(0.0f32, f32::max);
    let mean = s.iter().sum::<f32>() / s.len().max(1) as f32;
    let zeros = s.iter().filter(|v| **v == 0.0).count();
    let db = |v: f32| if v > 0.0 { 20.0 * v.log10() } else { f32::NEG_INFINITY };
    println!("callbacks: {} zero-buffers: {}", s.len(), zeros);
    println!("rms mean {mean:.6} ({:.1} dBFS)  max {max:.6} ({:.1} dBFS)", db(mean), db(max));
    let level = |v: f32| ((db(v) + 60.0) / 60.0).clamp(0.0, 1.0);
    println!("old level mapping: mean {:.2} max {:.2}  (old threshold 0.35)", level(mean), level(max));
}
