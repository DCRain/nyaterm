/// Per-connection local terminal config.
pub struct LocalSessionConfig {
    pub connection_id: Option<String>,
    pub shell_path: String,
    pub shell_args: String,
    pub working_dir: Option<String>,
    pub fail_on_missing_working_dir: bool,
    pub name: String,
    pub encoding: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ShellCommandSpec {
    program: String,
    args: Vec<String>,
}
