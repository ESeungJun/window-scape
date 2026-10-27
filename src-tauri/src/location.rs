//! macOS CoreLocation 으로 현재 위치를 얻는다.
//! WebKit 의 navigator.geolocation 은 Tauri 창에서 권한 처리가 안 돼 직접 구현한다.
//! 델리게이트 없이 CLLocationManager 를 켜 두고 `location` 값이 채워질 때까지 짧게 확인한다.

use std::{
  sync::{Mutex, mpsc},
  time::{Duration, Instant},
};

use objc2::rc::Retained;
use objc2_core_location::{CLAuthorizationStatus, CLLocationManager};
use tauri::AppHandle;

const TIMEOUT: Duration = Duration::from_secs(15);
const POLL: Duration = Duration::from_millis(300);
/// 날씨 조회에는 약 1km 정밀도면 충분하다
const ACCURACY_METERS: f64 = 1000.0;

/// CLLocationManager 는 메인 스레드에서만 만들고 쓴다(run_on_main_thread 로만 접근).
/// 정적 변수에 두기 위해 Send 로 표시한다.
struct Manager(Retained<CLLocationManager>);
unsafe impl Send for Manager {}

static MANAGER: Mutex<Option<Manager>> = Mutex::new(None);

pub enum LocationError {
  Denied,
  Unavailable,
  Timeout,
}

impl LocationError {
  pub fn code(&self) -> &'static str {
    match self {
      LocationError::Denied => "denied",
      LocationError::Unavailable => "unavailable",
      LocationError::Timeout => "timeout",
    }
  }
}

enum Poll {
  Pending,
  Denied,
  Found(f64, f64),
}

/// 메인 스레드에서 실행하고 결과를 기다린다.
fn on_main<T: Send + 'static>(app: &AppHandle, f: impl FnOnce() -> T + Send + 'static) -> Result<T, LocationError> {
  let (tx, rx) = mpsc::channel();
  app
    .run_on_main_thread(move || {
      let _ = tx.send(f());
    })
    .map_err(|_| LocationError::Unavailable)?;
  rx.recv_timeout(Duration::from_secs(2)).map_err(|_| LocationError::Unavailable)
}

/// 소수 2자리로 줄인 (위도, 경도). 정밀 좌표는 이 함수 밖으로 나가지 않는다.
pub fn current(app: &AppHandle) -> Result<(f64, f64), LocationError> {
  on_main(app, || {
    let mut guard = MANAGER.lock().unwrap_or_else(|e| e.into_inner());
    let manager = guard.get_or_insert_with(|| Manager(unsafe { CLLocationManager::new() }));
    unsafe {
      manager.0.setDesiredAccuracy(ACCURACY_METERS);
      manager.0.requestWhenInUseAuthorization();
      manager.0.startUpdatingLocation();
    }
  })?;

  let started = Instant::now();
  let result = loop {
    let poll = on_main(app, || {
      let guard = MANAGER.lock().unwrap_or_else(|e| e.into_inner());
      let Some(manager) = guard.as_ref() else { return Poll::Pending };
      let status = unsafe { manager.0.authorizationStatus() };
      if status == CLAuthorizationStatus::Denied || status == CLAuthorizationStatus::Restricted {
        return Poll::Denied;
      }
      match unsafe { manager.0.location() } {
        Some(loc) => {
          let c = unsafe { loc.coordinate() };
          Poll::Found(c.latitude, c.longitude)
        }
        None => Poll::Pending,
      }
    })?;
    match poll {
      Poll::Found(lat, lon) => break Ok((coarse(lat), coarse(lon))),
      Poll::Denied => break Err(LocationError::Denied),
      // 권한 창이 떠 있는 동안에도 기다린다
      Poll::Pending if started.elapsed() > TIMEOUT => break Err(LocationError::Timeout),
      Poll::Pending => std::thread::sleep(POLL),
    }
  };

  let _ = on_main(app, || {
    if let Some(manager) = MANAGER.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
      unsafe { manager.0.stopUpdatingLocation() };
    }
  });
  result
}

fn coarse(deg: f64) -> f64 {
  (deg * 100.0).round() / 100.0
}
