#[derive(Clone, Debug)]
struct TranscriptRecord {
    line_id: u64,
    timestamp: String,
    kind: TranscriptEventKind,
    data: String,
    size_bytes: usize,
}

impl TranscriptRecord {
    fn new(line_id: u64, kind: TranscriptEventKind, data: String) -> Self {
        let timestamp = chrono_timestamp();
        let size_bytes = format_record_parts(&timestamp, kind.label(), &data, true, true).len();
        Self {
            line_id,
            timestamp,
            kind,
            data,
            size_bytes,
        }
    }

    fn format(&self, include_io_labels: bool, include_timestamps: bool) -> String {
        format_record_parts(
            &self.timestamp,
            self.kind.label(),
            &self.data,
            include_io_labels,
            include_timestamps,
        )
    }
}

