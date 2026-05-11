export function parseCliVersion(output: string): string | null {
    const match = output.trim().match(/(\d+\.\d+\.\d+)/);
    return match ? match[1] : null;
}
