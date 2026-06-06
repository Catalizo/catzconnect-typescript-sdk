type MessageType = "Verification" | "Transactional";
type Channel = "Email";
type Template = "Otp" | "Custom";
interface SendInput {
    channel: Channel;
    type: MessageType;
    template: Template;
    identity: string;
    payload: SendPayload;
}
interface SendPayload {
    to?: string;
    otp?: string;
    subject?: string;
    body?: string;
}
interface EnvValues {
    api_key: string;
    private_key: string;
    server_public_key: string;
}

declare class CatzConnect {
    private http;
    send(input: SendInput, env?: EnvValues): Promise<any>;
}
declare const catzconnect: CatzConnect;

export { catzconnect };
