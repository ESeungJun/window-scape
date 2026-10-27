//! 하늘섬 날씨 데스크톱 위젯.
//! 웹 화면을 테두리 없는 투명 창에 띄우고, 메뉴 막대 아이콘으로 배치·자동 실행을 제어한다.

use tauri::{
  AppHandle, Manager, PhysicalPosition, WebviewWindow,
  menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
  tray::TrayIconBuilder,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

const WINDOW: &str = "main";
/// 화면 가장자리와 띄울 간격(논리 픽셀)
const MARGIN: f64 = 16.0;

#[derive(Clone, Copy)]
enum Corner {
  TopLeft,
  TopRight,
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

/// 바탕화면 고정(다른 창 아래)과 항상 위는 동시에 켜질 수 없다.
fn set_layer(window: &WebviewWindow, desktop: bool, top: bool) {
  let _ = window.set_always_on_top(top);
  let _ = window.set_always_on_bottom(desktop);
}

fn quit(app: &AppHandle) {
  let _ = app.save_window_state(StateFlags::SIZE | StateFlags::POSITION);
  app.exit(0);
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
      let _ = window.set_visible_on_all_workspaces(true);
      set_layer(&window, true, false);
      window.show()?;

      let desktop = CheckMenuItem::with_id(app, "desktop", "바탕화면에 고정", true, true, None::<&str>)?;
      let on_top = CheckMenuItem::with_id(app, "top", "항상 위에 표시", true, false, None::<&str>)?;
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

      let icon = app.default_window_icon().cloned().expect("앱 아이콘이 없다");
      TrayIconBuilder::with_id("tray")
        .icon(icon)
        .tooltip("하늘섬 날씨")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(move |app, event| {
          let Some(window) = app.get_webview_window(WINDOW) else { return };
          match event.id().as_ref() {
            // 체크 항목은 클릭되면 상태가 이미 뒤집혀 있다
            "desktop" => {
              let on = desktop.is_checked().unwrap_or(false);
              if on {
                let _ = on_top.set_checked(false);
              }
              set_layer(&window, on, false);
            }
            "top" => {
              let on = on_top.is_checked().unwrap_or(false);
              if on {
                let _ = desktop.set_checked(false);
              }
              set_layer(&window, false, on);
            }
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
