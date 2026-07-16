declare module '*.mjs' {
  export const counterfeits: Record<string, (input: Record<string, any>) => Record<string, any>>;
  export const projectMachineWideQuotaNotifications: (
    input: Record<string, any>,
  ) => Record<string, any>;
}
