import trustme

if __name__ == "__main__":
    print("Generating local SSL certificate for 127.0.0.1...")
    ca = trustme.CA()
    cert = ca.issue_cert("localhost", "127.0.0.1")
    
    cert.private_key_pem.write_to_path("key.pem")
    cert.cert_chain_pems[0].write_to_path("cert.pem")
    print("Successfully generated key.pem and cert.pem")
