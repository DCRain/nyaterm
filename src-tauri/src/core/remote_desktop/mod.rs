//! External RDP / VNC client detection and launch.
//!
//! These connections are not registered in `SessionManager`; NyaTerm only
//! detects a suitable desktop client and spawns it.

mod detect;
mod launch;

pub use detect::{RemoteDesktopClientInfo, RemoteDesktopProtocol, list_remote_desktop_clients};
pub use launch::{LaunchRemoteDesktopRequest, LaunchRemoteDesktopResult, launch_remote_desktop};

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::ConnectionType;
    use launch::RdpLaunchOptions;

    fn options_fullscreen() -> RdpLaunchOptions {
        RdpLaunchOptions::default()
    }

    fn options_windowed(width: u16, height: u16) -> RdpLaunchOptions {
        RdpLaunchOptions {
            display_mode: "windowed".into(),
            width,
            height,
            ..RdpLaunchOptions::default()
        }
    }

    #[test]
    fn protocol_from_connection_type() {
        assert_eq!(
            RemoteDesktopProtocol::try_from(&ConnectionType::Rdp {
                host: "h".into(),
                port: 3389,
                username: String::new(),
                domain: String::new(),
                client_mode: "external".into(),
                security: Default::default(),
                display: Default::default(),
                clipboard: Default::default(),
                reconnect: Default::default(),
                display_mode: "fullscreen".into(),
                width: 1920,
                height: 1080,
                redirect_clipboard: true,
                redirect_printers: false,
                redirect_com_ports: false,
                redirect_smart_cards: false,
                drive_redirect: "*".into(),
                device_redirect: String::new(),
                camera_redirect: String::new(),
                audio_mode: 0,
                audio_capture: true,
                keyboard_hook: 2,
                preferred_client: String::new(),
            })
            .unwrap(),
            RemoteDesktopProtocol::Rdp
        );
        assert_eq!(
            RemoteDesktopProtocol::try_from(&ConnectionType::Vnc {
                host: "h".into(),
                port: 5900,
            })
            .unwrap(),
            RemoteDesktopProtocol::Vnc
        );
        assert!(
            RemoteDesktopProtocol::try_from(&ConnectionType::Ssh {
                host: "h".into(),
                port: 22,
                username: "u".into(),
                backspace_mode: "del".into(),
                x11_forwarding: false,
                agent_endpoint: Default::default(),
                agent_forwarding: false,
                encoding: String::new(),
            })
            .is_err()
        );
    }

    #[test]
    fn rdp_file_includes_resolution_and_defaults() {
        let content = launch::build_rdp_file_contents(
            "10.0.0.1",
            3390,
            Some("alice"),
            &options_fullscreen(),
            (1920, 1080),
        );
        assert!(content.contains("full address:s:10.0.0.1:3390"));
        assert!(content.contains("username:s:alice"));
        assert!(content.contains("screen mode id:i:2"));
        assert!(content.contains("desktopwidth:i:1920"));
        assert!(content.contains("desktopheight:i:1080"));
        assert!(content.contains("redirectclipboard:i:1"));
        assert!(content.contains("drivestoredirect:s:*"));
        assert!(content.contains("audiomode:i:0"));
        assert!(content.contains("audiocapturemode:i:1"));
        assert!(content.contains("keyboardhook:i:2"));
        assert!(!content.to_lowercase().contains("password"));
        assert!(!content.contains("winposstr"));
        assert!(content.contains("dynamic resolution:i:0"));
    }

    #[test]
    fn rdp_file_empty_username_becomes_administrator() {
        let content = launch::build_rdp_file_contents(
            "host.example",
            3389,
            Some(""),
            &options_fullscreen(),
            (1920, 1080),
        );
        assert!(content.contains("username:s:administrator"));
    }

    #[test]
    fn rdp_file_windowed_includes_centered_winposstr() {
        let content = launch::build_rdp_file_contents(
            "host",
            3389,
            None,
            &options_windowed(800, 600),
            (1920, 1080),
        );
        assert!(content.contains("screen mode id:i:1"));
        assert!(content.contains("desktopwidth:i:800"));
        assert!(content.contains("desktopheight:i:600"));
        assert!(content.contains("winposstr:s:0,1,560,240,1360,840"));
        assert!(content.contains("dynamic resolution:i:1"));
    }

    #[test]
    fn centered_winposstr_math() {
        assert_eq!(
            launch::centered_winposstr(800, 600, (1920, 1080)),
            "0,1,560,240,1360,840"
        );
    }

    #[test]
    fn freerdp_args_include_size_clipboard_and_fullscreen() {
        let args = launch::build_freerdp_args("host", 3389, Some("bob"), &options_fullscreen());
        assert!(args.contains(&"/v:host:3389".to_string()));
        assert!(args.contains(&"/u:bob".to_string()));
        assert!(args.contains(&"/w:1920".to_string()));
        assert!(args.contains(&"/h:1080".to_string()));
        assert!(args.contains(&"/f".to_string()));
        assert!(args.contains(&"+clipboard".to_string()));
        assert!(args.contains(&"/audio-mode:0".to_string()));
    }

    #[test]
    fn freerdp_args_windowed_without_fullscreen_flag() {
        let args =
            launch::build_freerdp_args("host", 3389, None, &options_windowed(1600, 900));
        assert!(args.contains(&"/w:1600".to_string()));
        assert!(args.contains(&"/h:900".to_string()));
        assert!(!args.iter().any(|arg| arg == "/f"));
        assert!(args.contains(&"+dynamic-resolution".to_string()));
        assert!(args.contains(&"/u:administrator".to_string()));
    }

    #[test]
    fn normalize_rdp_username_defaults() {
        assert_eq!(launch::normalize_rdp_username(String::new()), "administrator");
        assert_eq!(launch::normalize_rdp_username("  ".into()), "administrator");
        assert_eq!(launch::normalize_rdp_username(" alice ".into()), "alice");
    }

    #[test]
    fn zero_resolution_falls_back_to_1080p() {
        let mut options = options_fullscreen();
        options.width = 0;
        options.height = 0;
        let content =
            launch::build_rdp_file_contents("host", 3389, None, &options, (1920, 1080));
        assert!(content.contains("desktopwidth:i:1920"));
        assert!(content.contains("desktopheight:i:1080"));
    }

    #[test]
    fn vnc_target_uses_tigervnc_port_syntax() {
        assert_eq!(
            launch::build_vncviewer_target("192.168.1.5", 5901),
            "192.168.1.5::5901"
        );
    }

    #[test]
    fn client_priority_lists_are_ordered() {
        let rdp = detect::candidate_specs(RemoteDesktopProtocol::Rdp);
        let vnc = detect::candidate_specs(RemoteDesktopProtocol::Vnc);
        assert!(!rdp.is_empty());
        assert!(!vnc.is_empty());
        assert_eq!(
            rdp.first().map(|c| c.id),
            Some(detect::primary_rdp_client_id())
        );
        assert_eq!(
            vnc.first().map(|c| c.id),
            Some(detect::primary_vnc_client_id())
        );
        #[cfg(target_os = "windows")]
        {
            assert_eq!(rdp.get(1).map(|c| c.id), Some("windows-app"));
        }
    }

    #[test]
    fn missing_client_recommendations_are_non_empty() {
        let recs = detect::install_recommendations(RemoteDesktopProtocol::Rdp);
        assert!(!recs.is_empty());
        assert!(recs.iter().all(|r| !r.install_hint.is_empty()));
        let vnc = detect::install_recommendations(RemoteDesktopProtocol::Vnc);
        assert!(!vnc.is_empty());
    }
}
