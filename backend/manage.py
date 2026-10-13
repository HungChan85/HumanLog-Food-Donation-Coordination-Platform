"""Generate signing keys without storing secrets in source control."""
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

if __name__ == "__main__":
    destination = Path(__file__).parent / "keys"
    destination.mkdir(exist_ok=True)
    if (destination / "private.pem").exists() or (destination / "public.pem").exists():
        raise SystemExit("Keys already exist; existing sessions were preserved.")
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    (destination / "private.pem").write_bytes(private.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    (destination / "public.pem").write_bytes(private.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo))
    print("Created backend/keys/private.pem and public.pem. Keep the private key secret.")

