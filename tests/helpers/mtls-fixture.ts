import forge from "node-forge";

export type MtlsFixture = {
  caCertificate: string;
  serverCertificate: string;
  serverPrivateKey: string;
  clientCertificate: string;
  clientPrivateKey: string;
  encryptedClientPrivateKey: string;
  clientPassphrase: string;
};

type CertificateIdentity = "ca" | "server" | "client";

function certificate(
  identity: CertificateIdentity,
  keys: forge.pki.rsa.KeyPair,
  issuer?: { certificate: forge.pki.Certificate; privateKey: forge.pki.PrivateKey },
): forge.pki.Certificate {
  const value = forge.pki.createCertificate();
  value.version = 2;
  value.publicKey = keys.publicKey;
  value.serialNumber = `01${forge.util.bytesToHex(forge.random.getBytesSync(15))}`;
  value.validity.notBefore = new Date(Date.now() - 60_000);
  value.validity.notAfter = new Date(Date.now() + 24 * 60 * 60_000);
  const commonName = identity === "ca" ? "Janus Studio Test CA" : identity === "server" ? "localhost" : "Janus Studio Test Client";
  value.setSubject([{ name: "commonName", value: commonName }]);
  value.setIssuer(issuer?.certificate.subject.attributes ?? value.subject.attributes);
  value.setExtensions(identity === "ca"
    ? [
        { name: "basicConstraints", cA: true, critical: true },
        { name: "keyUsage", keyCertSign: true, cRLSign: true, digitalSignature: true, critical: true },
        { name: "subjectKeyIdentifier" },
      ]
    : [
        { name: "basicConstraints", cA: false, critical: true },
        { name: "keyUsage", digitalSignature: true, keyEncipherment: true, critical: true },
        { name: "extKeyUsage", serverAuth: identity === "server", clientAuth: identity === "client" },
        ...(identity === "server"
          ? [{ name: "subjectAltName", altNames: [{ type: 2, value: "localhost" }, { type: 7, ip: "127.0.0.1" }] }]
          : []),
        { name: "subjectKeyIdentifier" },
      ]);
  value.sign(issuer?.privateKey ?? keys.privateKey, forge.md.sha256.create());
  return value;
}

export function createMtlsFixture(): MtlsFixture {
  const caKeys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  const caCertificate = certificate("ca", caKeys);
  const issuer = { certificate: caCertificate, privateKey: caKeys.privateKey };
  const serverKeys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  const clientKeys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  const clientPassphrase = "janus-studio-test-passphrase";

  return {
    caCertificate: forge.pki.certificateToPem(caCertificate),
    serverCertificate: forge.pki.certificateToPem(certificate("server", serverKeys, issuer)),
    serverPrivateKey: forge.pki.privateKeyToPem(serverKeys.privateKey),
    clientCertificate: forge.pki.certificateToPem(certificate("client", clientKeys, issuer)),
    clientPrivateKey: forge.pki.privateKeyToPem(clientKeys.privateKey),
    encryptedClientPrivateKey: forge.pki.encryptRsaPrivateKey(clientKeys.privateKey, clientPassphrase, { algorithm: "aes256" }),
    clientPassphrase,
  };
}
