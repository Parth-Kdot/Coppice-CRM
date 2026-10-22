import { describe, expect, it } from "vitest";
import { connectionConfig } from "@/lib/db";

// Production talks to Supabase over verified SSL. These check the settings the app builds;
// the real handshake against Supabase is checked during the deploy.
const URL = "postgresql://app_user.ref:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres";
const CERT = "-----BEGIN CERTIFICATE-----\nMIIDxTCCAq2gAwIBAgIBADANBgkq\n-----END CERTIFICATE-----";

describe("connectionConfig", () => {
  it("refuses to start without DATABASE_URL", () => {
    expect(() => connectionConfig({})).toThrow("DATABASE_URL is not set");
  });

  it("locally, with no certificate, just uses the URL", () => {
    expect(connectionConfig({ DATABASE_URL: URL })).toEqual({ connectionString: URL });
  });

  it("with Supabase's certificate, verifies the server (rejectUnauthorized)", () => {
    expect(connectionConfig({ DATABASE_URL: URL, DATABASE_CA_CERT: CERT })).toEqual({
      connectionString: URL,
      ssl: { ca: CERT, rejectUnauthorized: true },
    });
  });

  it("accepts a certificate pasted on one line with \\n escapes", () => {
    const oneLine = CERT.replace(/\n/g, "\\n");
    expect(connectionConfig({ DATABASE_URL: URL, DATABASE_CA_CERT: oneLine }).ssl).toEqual({
      ca: CERT,
      rejectUnauthorized: true,
    });
  });

  it("refuses something that isn't a certificate", () => {
    expect(() => connectionConfig({ DATABASE_URL: URL, DATABASE_CA_CERT: "oops" })).toThrow("PEM certificate");
  });

  it.each(["?sslmode=require", "?sslmode=no-verify", "?x=1&SSLMODE=disable"])(
    "refuses %s in the URL, which would silently replace the certificate check",
    (query) => {
      expect(() => connectionConfig({ DATABASE_URL: URL + query, DATABASE_CA_CERT: CERT })).toThrow(
        "Remove sslmode",
      );
    },
  );
});
