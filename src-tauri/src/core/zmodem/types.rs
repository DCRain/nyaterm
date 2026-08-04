/// Direction of the ZMODEM transfer from the **local** perspective.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ZmodemDirection {
    /// Remote `sz` → we **download** (receive) files.
    Download,
    /// Remote `rz` → we **upload** (send) files.
    Upload,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ZmodemUploadConflictMode {
    Overwrite,
    Skip,
}

impl ZmodemUploadConflictMode {
    pub fn from_wire(value: Option<&str>) -> Self {
        match value {
            Some(value) if value.eq_ignore_ascii_case("skip") => Self::Skip,
            _ => Self::Overwrite,
        }
    }

    fn file_options(self) -> zmodem2::ZfileManagementOption {
        match self {
            Self::Overwrite => zmodem2::ZfileManagementOption::ZMCLOB,
            Self::Skip => zmodem2::ZfileManagementOption::ZMSKNOLOC,
        }
    }
}

pub struct ZmodemPreparedUpload {
    pub files: Vec<PathBuf>,
    pub conflict_mode: ZmodemUploadConflictMode,
    pub preserve_timestamps: bool,
}

/// Events emitted to the frontend via Tauri events.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ZmodemEvent {
    /// A ZMODEM session was detected — frontend should show a file dialog.
    Detected { direction: ZmodemDirection },
    /// Progress update for an active transfer.
    Progress {
        #[serde(rename = "fileName")]
        file_name: String,
        #[serde(rename = "bytesTransferred")]
        bytes_transferred: u64,
        #[serde(rename = "totalSize")]
        total_size: u64,
        #[serde(rename = "localPath")]
        local_path: Option<String>,
        direction: ZmodemDirection,
    },
    /// The ZMODEM session completed successfully.
    Complete {
        direction: ZmodemDirection,
        #[serde(rename = "fileCount")]
        file_count: u32,
    },
    /// The ZMODEM session failed.
    Failed { reason: String },
}

/// Creates a transfer and optionally auto-accepts a prepared upload.
pub fn start_zmodem_transfer(
    direction: ZmodemDirection,
    initial_bytes: &[u8],
    prepared_upload: Option<ZmodemPreparedUpload>,
) -> (ZmodemTransfer, Vec<ZmodemAction>) {
    let mut transfer = ZmodemTransfer::new(direction, initial_bytes);
    let bootstrap_actions = match (direction, prepared_upload) {
        (ZmodemDirection::Upload, Some(upload)) => {
            transfer.accept_upload(
                upload.files,
                upload.conflict_mode,
                upload.preserve_timestamps,
            )
        }
        _ => Vec::new(),
    };
    (transfer, bootstrap_actions)
}

/// Actions returned to the I/O loop after feeding bytes.
pub enum ZmodemAction {
    /// Send these bytes back to the remote (protocol responses).
    SendToRemote(Vec<u8>),
    /// Emit a Tauri event to the frontend.
    EmitEvent(ZmodemEvent),
}

/// Result of scanning a raw byte chunk for ZMODEM startup.
pub enum ZmodemDetectResult {
    /// No complete header was detected. `passthrough` is known-safe terminal text.
    NoMatch { passthrough: Vec<u8> },
    /// A ZMODEM header was detected.
    Detected {
        direction: ZmodemDirection,
        passthrough: Vec<u8>,
        initial_bytes: Vec<u8>,
    },
}

