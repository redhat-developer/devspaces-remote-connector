import { execFileSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as https from 'https';
import * as path from 'path';
import * as os from 'os';
import * as tls from 'tls';

/** Cached extra CA certificates (PEM format) */
let extraCAs: string | undefined;

/**
 * Load the system CA certificates into Node's TLS trust store.
 *
 * Strategy:
 * 1. Export CAs from the OS keychain/store
 * 2. Set NODE_EXTRA_CA_CERTS (works if Node hasn't frozen the root store yet)
 * 3. Cache the CAs so getHttpsAgent() can use them as a fallback
 *
 * Call once during extension activation, before any HTTPS calls.
 */
export function loadSystemCAs(): void {
  if (process.env.NODE_EXTRA_CA_CERTS) {
    // User already configured custom CAs — load them for our agent fallback
    try {
      extraCAs = fs.readFileSync(process.env.NODE_EXTRA_CA_CERTS, 'utf-8');
    } catch { /* ignore */ }
    return;
  }

  try {
    let certs: string | undefined;

    if (process.platform === 'darwin') {
      // macOS: export from system keychains + user login keychain
      const keychains = [
        '/System/Library/Keychains/SystemRootCertificates.keychain',
        '/Library/Keychains/System.keychain',
      ];
      const loginKeychain = path.join(os.homedir(), 'Library/Keychains/login.keychain-db');
      if (fs.existsSync(loginKeychain)) {
        keychains.push(loginKeychain);
      }

      certs = execFileSync('security', [
        'find-certificate', '-a', '-p',
        ...keychains,
      ], { encoding: 'utf-8', timeout: 15_000 });

    } else if (process.platform === 'win32') {
      // Windows: export from certutil (Root + CA stores)
      certs = execFileSync('powershell', [
        '-NoProfile', '-Command',
        `@('Root','CA') | ForEach-Object {
          Get-ChildItem -Path "Cert:\\LocalMachine\\$_" | ForEach-Object {
            "-----BEGIN CERTIFICATE-----"
            [Convert]::ToBase64String($_.RawData, 'InsertLineBreaks')
            "-----END CERTIFICATE-----"
          }
        }`,
      ], { encoding: 'utf-8', timeout: 15_000 });

    } else {
      // Linux: check common CA bundle locations
      const linuxPaths = [
        '/etc/ssl/certs/ca-certificates.crt',
        '/etc/pki/tls/certs/ca-bundle.crt',
        '/etc/ssl/ca-bundle.pem',
        '/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem',
      ];
      for (const p of linuxPaths) {
        if (fs.existsSync(p)) {
          process.env.NODE_EXTRA_CA_CERTS = p;
          extraCAs = fs.readFileSync(p, 'utf-8');
          return;
        }
      }
    }

    if (certs && certs.length > 100) {
      extraCAs = certs;
      const caFile = path.join(os.tmpdir(), `devspaces-cas-${crypto.randomBytes(8).toString('hex')}.pem`);
      fs.writeFileSync(caFile, certs, { mode: 0o600 });
      process.env.NODE_EXTRA_CA_CERTS = caFile;
    }
  } catch {
    // Best-effort — system CAs will be used as fallback
  }

}

/**
 * Get an HTTPS agent that trusts both Node's built-in roots AND the
 * extra CAs we loaded (system CAs).
 *
 * Use this for all HTTPS requests in the extension to ensure enterprise
 * CAs are trusted regardless of whether NODE_EXTRA_CA_CERTS took effect.
 */
export function getHttpsAgent(): https.Agent {
  const ca = buildCAList();
  return new https.Agent({ ca });
}

/**
 * Build the full CA list: Node's built-in roots + our extra CAs.
 */
function buildCAList(): (string | Buffer)[] {
  const cas: (string | Buffer)[] = [...tls.rootCertificates];

  if (extraCAs) {
    // Split PEM bundle into individual certs
    const certs = extraCAs.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
    if (certs) {
      cas.push(...certs);
    }
  }

  return cas;
}
