type MessageType = "Verification";
type Channel = "Email";
type Template = "Otp";
interface SendInput {
    channel: Channel;
    type: MessageType;
    template: Template;
    payload: SendPayload;
}
interface SendPayload {
    to?: string;
    otp?: string;
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
