//! 창밖날씨 데스크톱 위젯.
//! 웹 화면을 테두리 없는 투명 창에 띄우고, 메뉴 막대 아이콘으로 배치·자동 실행을 제어한다.
//! 창 배치는 설정 화면에서도 바꿀 수 있고(get_layer/set_layer), 업데이트는 updater 플러그인이 맡는다.

#[cfg(target_os = "macos")]
mod location;

use std::path::PathBuf;

use tauri::{
  AppHandle, Emitter, Manager, PhysicalPosition, WebviewWindow, Wry,
  menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
  tray::TrayIconBuilder,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

const WINDOW: &str = "main";
/// 화면 가장자리와 띄울 간격(논리 픽셀)
const MARGIN: f64 = 16.0;
const LAYER_FILE: &str = "layer";

#[derive(Clone, Copy)]
enum Corner {
  TopLeft,
  TopRight,
}

/// 창이 놓이는 층. 바탕화면 고정(다른 창 아래)과 항상 위는 동시에 켜질 수 없다.
#[derive(Clone, Copy, PartialEq)]
enum Layer {
  Desktop,
  Normal,
  Top,
}

impl Layer {
  fn as_str(self) -> &'static str {
    match self {
      Layer::Desktop => "desktop",
      Layer::Normal => "normal",
      Layer::Top => "top",
    }
  }

  fn parse(s: &str) -> Option<Self> {
    match s.trim() {
      "desktop" => Some(Layer::Desktop),
      "normal" => Some(Layer::Normal),
      "top" => Some(Layer::Top),
      _ => None,
    }
  }

  fn apply(self, window: &WebviewWindow) {
    // macOS 는 창 높이(level)가 하나라, 끄는 호출도 높이를 '일반'으로 되돌린다.
    // 그래서 끄는 쪽을 먼저, 켜는 쪽을 나중에 불러야 켠 값이 남는다
    match self {
      Layer::Top => {
        let _ = window.set_always_on_bottom(false);
        let _ = window.set_always_on_top(true);
      }
      Layer::Desktop => {
        let _ = window.set_always_on_top(false);
        let _ = window.set_always_on_bottom(true);
      }
      Layer::Normal => {
        let _ = window.set_always_on_top(false);
        let _ = window.set_always_on_bottom(false);
      }
    }
  }
}

fn layer_path(app: &AppHandle) -> Option<PathBuf> {
  app.path().app_config_dir().ok().map(|dir| dir.join(LAYER_FILE))
}

/// 저장된 층을 읽는다. 없거나 깨졌으면 항상 위.
fn load_layer(app: &AppHandle) -> Layer {
  layer_path(app)
    .and_then(|p| std::fs::read_to_string(p).ok())
    .and_then(|s| Layer::parse(&s))
    .unwrap_or(Layer::Top)
}

fn save_layer(app: &AppHandle, layer: Layer) {
  if let Some(path) = layer_path(app) {
    if let Some(dir) = path.parent() {
      let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(path, layer.as_str());
  }
}

/// 메뉴 막대·Dock 을 뺀 작업 영역의 모서리로 창을 옮긴다.
fn snap(window: &WebviewWindow, corner: Corner) {
  let (Ok(Some(monitor)), Ok(size)) = (window.current_monitor(), window.outer_size()) else {
    return;
  };
  let area = monitor.work_area();
  let margin = (MARGIN * monitor.scale_factor()) as i32;
  let x = match corner {
    Corner::TopLeft => area.position.x + margin,
    Corner::TopRight => area.position.x + area.size.width as i32 - size.width as i32 - margin,
  };
  let _ = window.set_position(PhysicalPosition::new(x, area.position.y + margin));
}

/// 메뉴 막대의 배치 체크 항목. 설정 화면에서 바꿔도 체크 표시가 따라오게 보관한다
struct LayerMenu {
  desktop: CheckMenuItem<Wry>,
  top: CheckMenuItem<Wry>,
}

/// 배치를 바꾸는 유일한 경로: 메뉴 체크·창·저장 파일을 맞추고 설정 화면에 알린다
fn change_layer(app: &AppHandle, layer: Layer) {
  if let Some(menu) = app.try_state::<LayerMenu>() {
    let _ = menu.desktop.set_checked(layer == Layer::Desktop);
    let _ = menu.top.set_checked(layer == Layer::Top);
  }
  if let Some(window) = app.get_webview_window(WINDOW) {
    layer.apply(&window);
  }
  save_layer(app, layer);
  let _ = app.emit("layer-changed", layer.as_str());
}

/// 현재 창 배치: "desktop" | "normal" | "top"
#[tauri::command]
fn get_layer(app: AppHandle) -> String {
  load_layer(&app).as_str().to_string()
}

#[tauri::command]
fn set_layer(app: AppHandle, layer: String) -> Result<(), String> {
  let layer = Layer::parse(&layer).ok_or("unknown layer")?;
  change_layer(&app, layer);
  Ok(())
}

/// 창이 다른 창에 완전히 가려졌는지. 알 수 없으면 None.
#[cfg(target_os = "macos")]
fn is_occluded(app: &AppHandle) -> Option<bool> {
  /// NSWindowOcclusionStateVisible
  const VISIBLE: usize = 1 << 1;
  let window = app.get_webview_window(WINDOW)?;
  let ns_window = window.ns_window().ok()? as *mut objc2::runtime::AnyObject;
  if ns_window.is_null() {
    return None;
  }
  // 주 스레드에서만 부른다(watch_occlusion 이 run_on_main_thread 로 부른다)
  let state: usize = unsafe { objc2::msg_send![ns_window, occlusionState] };
  Some(state & VISIBLE == 0)
}

/// 창이 가려졌는지 지켜보다가 바뀌면 화면에 알린다. 화면은 가려진 동안 그리기를 멈춘다.
/// "바탕화면 고정"은 다른 창 뒤에 깔려 있는 시간이 대부분이라, 안 보이는 동안 GPU 를 쓰지 않게 한다.
#[cfg(target_os = "macos")]
fn watch_occlusion(app: &AppHandle) {
  use std::{sync::mpsc, thread, time::Duration};

  let app = app.clone();
  thread::spawn(move || {
    let mut last = None;
    loop {
      thread::sleep(Duration::from_millis(1500));
      let (tx, rx) = mpsc::channel();
      let handle = app.clone();
      let ask = move || {
        let _ = tx.send(is_occluded(&handle));
      };
      if app.run_on_main_thread(ask).is_err() {
        break;
      }
      let Ok(Some(occluded)) = rx.recv_timeout(Duration::from_secs(2)) else { continue };
      if last != Some(occluded) {
        last = Some(occluded);
        let _ = app.emit("occlusion-changed", occluded);
      }
    }
  });
}

fn quit(app: &AppHandle) {
  let _ = app.save_window_state(StateFlags::SIZE | StateFlags::POSITION);
  app.exit(0);
}

/// 현재 위치(소수 2자리). 실패하면 "denied" | "unavailable" | "timeout".
#[tauri::command]
async fn current_location(app: AppHandle) -> Result<(f64, f64), String> {
  #[cfg(target_os = "macos")]
  {
    tauri::async_runtime::spawn_blocking(move || location::current(&app).map_err(|e| e.code().to_string()))
      .await
      .map_err(|_| "unavailable".to_string())?
  }
  #[cfg(not(target_os = "macos"))]
  {
    let _ = app;
    Err("unavailable".to_string())
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(
      tauri_plugin_window_state::Builder::default()
        .with_state_flags(StateFlags::SIZE | StateFlags::POSITION)
        .build(),
    )
    .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
    .invoke_handler(tauri::generate_handler![current_location, get_layer, set_layer])
    .setup(|app| {
      // Dock 아이콘 없이 메뉴 막대에만 사는 앱
      #[cfg(target_os = "macos")]
      app.set_activation_policy(tauri::ActivationPolicy::Accessory);

      let window = app.get_webview_window(WINDOW).expect("main 창이 설정에 없다");
      // 저장된 위치가 없으면(첫 실행) 우상단에 둔다
      let state_file = app.path().app_config_dir()?.join(app.handle().filename());
      if !state_file.exists() {
        snap(&window, Corner::TopRight);
      }
      let layer = load_layer(app.handle());
      let _ = window.set_visible_on_all_workspaces(true);
      layer.apply(&window);
      window.show()?;
      #[cfg(target_os = "macos")]
      watch_occlusion(app.handle());

      let desktop = CheckMenuItem::with_id(app, "desktop", "바탕화면에 고정", true, layer == Layer::Desktop, None::<&str>)?;
      let on_top = CheckMenuItem::with_id(app, "top", "항상 위에 표시", true, layer == Layer::Top, None::<&str>)?;
      let right = MenuItem::with_id(app, "right", "우상단으로 옮기기", true, None::<&str>)?;
      let left = MenuItem::with_id(app, "left", "좌상단으로 옮기기", true, None::<&str>)?;
      let autostart_on = app.autolaunch().is_enabled().unwrap_or(false);
      let autostart = CheckMenuItem::with_id(app, "autostart", "로그인 시 자동 실행", true, autostart_on, None::<&str>)?;
      let show = MenuItem::with_id(app, "show", "위젯 보이기", true, None::<&str>)?;
      let quit_item = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;
      let menu = Menu::with_items(
        app,
        &[
          &show,
          &PredefinedMenuItem::separator(app)?,
          &desktop,
          &on_top,
          &PredefinedMenuItem::separator(app)?,
          &right,
          &left,
          &PredefinedMenuItem::separator(app)?,
          &autostart,
          &quit_item,
        ],
      )?;

      app.manage(LayerMenu { desktop: desktop.clone(), top: on_top.clone() });

      let icon = app.default_window_icon().cloned().expect("앱 아이콘이 없다");
      TrayIconBuilder::with_id("tray")
        .icon(icon)
        .tooltip("창밖날씨")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(move |app, event| {
          let Some(window) = app.get_webview_window(WINDOW) else { return };
          // 체크 항목은 클릭 이벤트가 오기 전에 체크 상태가 이미 뒤집혀 있다
          match event.id().as_ref() {
            "desktop" => change_layer(app, if desktop.is_checked().unwrap_or(false) { Layer::Desktop } else { Layer::Normal }),
            "top" => change_layer(app, if on_top.is_checked().unwrap_or(false) { Layer::Top } else { Layer::Normal }),
            "right" => snap(&window, Corner::TopRight),
            "left" => snap(&window, Corner::TopLeft),
            "show" => {
              let _ = window.show();
              let _ = window.set_focus();
            }
            "autostart" => {
              let launcher = app.autolaunch();
              let want = autostart.is_checked().unwrap_or(false);
              let result = if want { launcher.enable() } else { launcher.disable() };
              if result.is_err() {
                // 실패하면 체크 표시를 실제 상태로 되돌린다
                let _ = autostart.set_checked(launcher.is_enabled().unwrap_or(false));
              }
            }
            "quit" => quit(app),
            _ => {}
          }
        })
        .build(app)?;
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("앱을 만들지 못했다")
    .run(|app, event| {
      // Cmd+Q 등으로 끝날 때도 위치·크기를 남긴다
      if let tauri::RunEvent::ExitRequested { .. } = event {
        let _ = app.save_window_state(StateFlags::SIZE | StateFlags::POSITION);
      }
    });
}
