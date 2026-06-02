export type PasswordResetEmailParams = {
    toEmail: string;
    toName?: string | null;
    resetUrl: string;
};
export declare class EmailService {
    private transporter;
    private getTransporter;
    sendPasswordResetEmail(params: PasswordResetEmailParams): Promise<void>;
}
export declare const emailService: EmailService;
//# sourceMappingURL=email.service.d.ts.map