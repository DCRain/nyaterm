import type { SshConfig } from "@/types/global";

export interface TemporarySshLinkConfig extends SshConfig {
  protocol: "ssh";
  backspace_mode: string;
  x11_forwarding: boolean;
  x11_display: string;
  proxy: null;
  proxy_jump: null;
  post_login: null;
}

export interface TemporaryTelnetLinkConfig {
  protocol: "telnet";
  name: string;
  host: string;
  port: number;
}

export interface TemporarySerialLinkConfig {
  protocol: "serial";
  name: string;
  portName: string;
  baudRate: number;
}

export type TemporaryLinkConfig =
  | TemporarySshLinkConfig
  | TemporaryTelnetLinkConfig
  | TemporarySerialLinkConfig;

export type TemporaryLinkProtocol = TemporaryLinkConfig["protocol"];
