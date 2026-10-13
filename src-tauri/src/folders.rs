//! Finding where Axiom, WorldEdit and Litematica keep their files, and saving
//! exported files there.
//!
//! Every launcher keeps its game folders (".minecraft", "instances",
//! "profiles") in a different place, so we look in the usual places and list
//! each game folder where a mod has already made its folder. Anything we miss
//! can still be picked by hand with the folder picker.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

/// Where each format's folder sits inside one game folder.
const MOD_FOLDERS: [(&str, &[&str]); 3] = [
    ("bp", &["config", "axiom", "blueprints"]),
    ("schem", &["config", "worldedit", "schematics"]),
    ("litematic", &["schematics"]),
];

/// One mod folder we found.
#[derive(Serialize)]
pub struct Found {
    /// "bp", "schem" or "litematic".
    format: &'static str,
    /// Which launcher it belongs to, e.g. "Modrinth".
    launcher: String,
    /// The instance or profile name; empty for the normal .minecraft folder.
    instance: String,
    path: String,
}

/// A launcher's instances: every folder inside `dir`, with the game folder
/// at `inner` inside each (e.g. "minecraft" for Prism, "" when the instance
/// folder is the game folder itself).
struct Instances {
    launcher: &'static str,
    dir: PathBuf,
    inner: &'static [&'static str],
}

/// The game folders of every launcher we know, that exist on this computer.
fn game_folders() -> Vec<(String, String, PathBuf)> {
    let mut out = Vec::new();
    let roaming = dirs::config_dir(); // Windows: C:\Users\<name>\AppData\Roaming
    let local = dirs::data_local_dir(); // Windows: C:\Users\<name>\AppData\Local
    let home = dirs::home_dir();

    // The official launcher's folder.
    if let Some(r) = &roaming {
        out.push(("Minecraft".into(), String::new(), r.join(".minecraft")));
    }
    if let Some(h) = &home {
        out.push(("Minecraft".into(), String::new(), h.join(".minecraft"))); // Linux
        out.push((
            "Minecraft".into(),
            String::new(),
            h.join("Library/Application Support/minecraft"), // Mac
        ));
    }

    let mut launchers: Vec<Instances> = Vec::new();
    if let Some(r) = &roaming {
        let at = |launcher: &'static str, rel: &str, inner: &'static [&'static str]| Instances { launcher, dir: r.join(rel), inner };
        launchers.push(at("Modrinth", "ModrinthApp/profiles", &[]));
        launchers.push(at("Modrinth", "com.modrinth.theseus/profiles", &[])); // before 0.8
        launchers.push(at("Prism", "PrismLauncher/instances", &["minecraft"]));
        launchers.push(at("Prism", "PrismLauncher/instances", &[".minecraft"]));
        launchers.push(at("PolyMC", "PolyMC/instances", &[".minecraft"]));
        launchers.push(at("ATLauncher", "ATLauncher/instances", &[]));
        launchers.push(at("GDLauncher", "gdlauncher_carbon/data/instances", &["instance"]));
        launchers.push(at("GDLauncher", "gdlauncher_next/instances", &[]));
    }
    if let Some(h) = &home {
        launchers.push(Instances { launcher: "CurseForge", dir: h.join("curseforge/minecraft/Instances"), inner: &[] });
    }
    if let Some(l) = &local {
        launchers.push(Instances { launcher: "FTB", dir: l.join(".ftba/instances"), inner: &[] });
    }

    for l in launchers {
        let Ok(entries) = fs::read_dir(&l.dir) else { continue };
        for e in entries.flatten() {
            let mut game = e.path();
            if !game.is_dir() {
                continue;
            }
            for part in l.inner {
                game.push(part);
            }
            let name = e.file_name().to_string_lossy().into_owned();
            out.push((l.launcher.into(), name, game));
        }
    }
    out
}

/// Lists every mod folder that already exists in a game folder we know.
#[tauri::command]
pub fn find_mod_folders() -> Vec<Found> {
    let mut found = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for (launcher, instance, game) in game_folders() {
        for (format, parts) in MOD_FOLDERS {
            let path: PathBuf = parts.iter().fold(game.clone(), |p, s| p.join(s));
            if path.is_dir() && seen.insert(path.clone()) {
                found.push(Found { format, launcher: launcher.clone(), instance: instance.clone(), path: path.to_string_lossy().into_owned() });
            }
        }
    }
    found
}

/// A plain file or folder name: no folder separators, no "..", nothing
/// Windows forbids. Keeps every save inside the folder the user chose.
fn plain_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 200
        && name != "."
        && name != ".."
        && !name.ends_with('.')
        && !name.ends_with(' ')
        && !name.chars().any(|c| matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control())
}

/// Reads a header that the page sent URI-encoded (headers can only carry plain ASCII).
fn header(req: &tauri::ipc::Request, key: &str) -> Result<String, String> {
    let raw = req.headers().get(key).and_then(|v| v.to_str().ok()).unwrap_or("");
    percent_decode(raw).ok_or_else(|| format!("bad {key}"))
}

fn percent_decode(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let hex = s.get(i + 1..i + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// Saves one file. The page sends the file's bytes as the body, and the
/// folder ("x-dir"), an optional subfolder ("x-sub") and the file name
/// ("x-name") as headers. Returns the full path written.
#[tauri::command]
pub fn save_file(request: tauri::ipc::Request) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("no file data".into());
    };
    let dir = header(&request, "x-dir")?;
    let sub = header(&request, "x-sub")?;
    let name = header(&request, "x-name")?;
    let dir = Path::new(&dir);
    if !dir.is_absolute() || !dir.is_dir() {
        return Err(format!("The folder {} doesn't exist any more. Choose it again.", dir.display()));
    }
    if !plain_name(&name) || (!sub.is_empty() && !plain_name(&sub)) {
        return Err(format!("“{name}” can't be used as a file name"));
    }
    let mut path = dir.to_path_buf();
    if !sub.is_empty() {
        path.push(&sub);
        fs::create_dir_all(&path).map_err(|e| format!("Couldn't make the folder {}: {e}", path.display()))?;
    }
    path.push(&name);
    fs::write(&path, bytes).map_err(|e| format!("Couldn't save {}: {e}", path.display()))?;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_names_only() {
        assert!(plain_name("facade_b1-b2-c1_5fl.bp"));
        assert!(plain_name("Ruelle des Fleurs"));
        for bad in ["", ".", "..", "../x.bp", "a/b", "a\\b", "C:x", "x.", "x?"] {
            assert!(!plain_name(bad), "{bad}");
        }
    }

    #[test]
    fn decodes_uri_encoding() {
        assert_eq!(percent_decode("C%3A%5CUsers%5Cj%C3%A9").as_deref(), Some("C:\\Users\\jé"));
        assert_eq!(percent_decode("%zz"), None);
    }
}
