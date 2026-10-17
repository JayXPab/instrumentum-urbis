//! Block textures and models from the user's own Minecraft.
//!
//! The game jar (one zip per Minecraft version, which every launcher keeps)
//! holds each block's textures, models and blockstates. We never ship these:
//! we find the jar the user already has, copy just those files out once into
//! the app's own folder, and read them from there.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::Manager;

/// The parts of the jar we copy, under `assets/minecraft/`.
const WANTED: [&str; 4] = ["textures/block/", "models/block/", "blockstates/", "textures/colormap/"];

/// A game jar we found.
#[derive(Serialize)]
pub struct Jar {
    launcher: &'static str,
    path: String,
}

/// What was copied, and from where (kept as `source.json` next to the files).
#[derive(Serialize, Deserialize)]
pub struct AssetInfo {
    jar: String,
    files: usize,
}

/// A Minecraft version name like "1.21.11": digits and dots only, so it is
/// safe to use as a folder name.
fn plain_version(v: &str) -> Result<&str, String> {
    if !v.is_empty() && v.len() <= 20 && v.chars().all(|c| c.is_ascii_digit() || c == '.') && !v.contains("..") {
        Ok(v)
    } else {
        Err(format!("“{v}” isn't a Minecraft version"))
    }
}

/// Where each launcher keeps the game jar for version `v`.
fn jar_places(v: &str) -> Vec<(&'static str, PathBuf)> {
    let mut out = Vec::new();
    let jar = format!("{v}.jar");
    if let Some(r) = dirs::config_dir() {
        // Windows: C:\Users\<name>\AppData\Roaming
        out.push(("Minecraft", r.join(".minecraft/versions").join(v).join(&jar)));
        out.push(("Modrinth", r.join("ModrinthApp/meta/versions").join(v).join(&jar)));
        out.push(("Modrinth", r.join("com.modrinth.theseus/meta/versions").join(v).join(&jar)));
        let client = format!("minecraft-{v}-client.jar");
        out.push(("Prism", r.join("PrismLauncher/libraries/com/mojang/minecraft").join(v).join(&client)));
        out.push(("PolyMC", r.join("PolyMC/libraries/com/mojang/minecraft").join(v).join(&client)));
        out.push(("ATLauncher", r.join("ATLauncher/versions").join(v).join(&jar)));
    }
    if let Some(h) = dirs::home_dir() {
        out.push(("CurseForge", h.join("curseforge/minecraft/Install/versions").join(v).join(&jar)));
        out.push(("Minecraft", h.join(".minecraft/versions").join(v).join(&jar))); // Linux
        out.push(("Minecraft", h.join("Library/Application Support/minecraft/versions").join(v).join(&jar))); // Mac
    }
    if let Some(l) = dirs::data_local_dir() {
        out.push(("FTB", l.join(".ftba/bin/versions").join(v).join(&jar)));
    }
    out
}

/// Lists the game jars for this version that exist on this computer.
#[tauri::command]
pub fn find_game_jars(version: String) -> Result<Vec<Jar>, String> {
    let v = plain_version(&version)?;
    let mut seen = std::collections::HashSet::new();
    Ok(jar_places(v)
        .into_iter()
        .filter(|(_, p)| p.is_file() && seen.insert(p.clone()))
        .map(|(launcher, p)| Jar { launcher, path: p.to_string_lossy().into_owned() })
        .collect())
}

/// The app's folder for one version's copied files.
fn store(app: &tauri::AppHandle, v: &str) -> Result<PathBuf, String> {
    let base = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    Ok(base.join("minecraft").join(v))
}

/// What has been copied for this version, if anything.
#[tauri::command]
pub fn assets_status(app: tauri::AppHandle, version: String) -> Result<Option<AssetInfo>, String> {
    let dir = store(&app, plain_version(&version)?)?;
    let Ok(text) = fs::read_to_string(dir.join("source.json")) else { return Ok(None) };
    Ok(serde_json::from_str(&text).ok())
}

/// Copies the wanted files out of `jar` into `dir` (emptied first).
fn extract(jar: &Path, dir: &Path) -> Result<AssetInfo, String> {
    let file = fs::File::open(jar).map_err(|e| format!("Couldn't open {}: {e}", jar.display()))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|_| format!("{} isn't a Minecraft game jar", jar.display()))?;
    if dir.exists() {
        fs::remove_dir_all(dir).map_err(|e| format!("Couldn't clear {}: {e}", dir.display()))?;
    }
    let mut files = 0;
    let mut buf = Vec::new();
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        let Some(rel) = entry.name().strip_prefix("assets/minecraft/") else { continue };
        if entry.is_dir() || !WANTED.iter().any(|w| rel.starts_with(w)) || !plain_path(rel) {
            continue;
        }
        let out = dir.join(rel);
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        buf.clear();
        entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        fs::write(&out, &buf).map_err(|e| format!("Couldn't write {}: {e}", out.display()))?;
        files += 1;
    }
    if files == 0 {
        return Err(format!("{} has no block textures in it. Is it the game jar?", jar.display()));
    }
    let info = AssetInfo { jar: jar.to_string_lossy().into_owned(), files };
    fs::write(dir.join("source.json"), serde_json::to_string(&info).unwrap()).map_err(|e| e.to_string())?;
    Ok(info)
}

/// Copies the block textures, models and blockstates out of the game jar.
/// Runs off the main thread: it takes a few seconds.
#[tauri::command]
pub async fn extract_assets(app: tauri::AppHandle, version: String, jar: String) -> Result<AssetInfo, String> {
    let dir = store(&app, plain_version(&version)?)?;
    let jar = PathBuf::from(jar);
    tauri::async_runtime::spawn_blocking(move || extract(&jar, &dir)).await.map_err(|e| e.to_string())?
}

/// A relative path made only of plain lowercase names: no "..", no drive or
/// root, nothing outside the copied folder. Minecraft's own names all fit.
fn plain_path(rel: &str) -> bool {
    !rel.is_empty()
        && rel.split('/').all(|part| {
            !part.is_empty() && part != "." && part != ".." && part.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '_' | '-' | '.'))
        })
}

/// Reads one copied file, e.g. "textures/block/stone_bricks.png".
#[tauri::command]
pub fn read_asset(app: tauri::AppHandle, version: String, path: String) -> Result<tauri::ipc::Response, String> {
    if !plain_path(&path) {
        return Err(format!("bad asset path “{path}”"));
    }
    let file = store(&app, plain_version(&version)?)?.join(&path);
    let bytes = fs::read(&file).map_err(|_| format!("{path} not found"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_and_paths() {
        assert!(plain_version("1.21.11").is_ok());
        for bad in ["", "../x", "1..2", "1.21/x", "a"] {
            assert!(plain_version(bad).is_err(), "{bad}");
        }
        assert!(plain_path("textures/block/stone_bricks.png"));
        assert!(plain_path("blockstates/oak_stairs.json"));
        for bad in ["", "../x.png", "a//b", "/abs", "C:/x", "a\\b", "x/../y", "Upper.png"] {
            assert!(!plain_path(bad), "{bad}");
        }
    }

    #[test]
    fn copies_only_block_files() {
        let tmp = std::env::temp_dir().join(format!("iu-assets-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        let jar = tmp.join("1.21.11.jar");
        {
            let mut z = zip::ZipWriter::new(fs::File::create(&jar).unwrap());
            let opt = zip::write::SimpleFileOptions::default();
            for (name, data) in [
                ("assets/minecraft/textures/block/stone.png", "png"),
                ("assets/minecraft/blockstates/stone.json", "{}"),
                ("assets/minecraft/models/block/stone.json", "{}"),
                ("assets/minecraft/textures/item/apple.png", "no"),
                ("net/minecraft/Main.class", "no"),
            ] {
                z.start_file(name, opt).unwrap();
                std::io::Write::write_all(&mut z, data.as_bytes()).unwrap();
            }
            z.finish().unwrap();
        }
        let out = tmp.join("out");
        let info = extract(&jar, &out).unwrap();
        assert_eq!(info.files, 3);
        assert_eq!(fs::read_to_string(out.join("textures/block/stone.png")).unwrap(), "png");
        assert!(!out.join("textures/item").exists());
        assert!(out.join("source.json").is_file());
        // Not a zip at all.
        assert!(extract(&out.join("source.json"), &tmp.join("out2")).is_err());
        fs::remove_dir_all(&tmp).unwrap();
    }
}
