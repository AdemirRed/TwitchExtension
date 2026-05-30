const selfsigned = require('selfsigned');
const fs = require('fs');
const path = require('path');

const attrs = [{ name: 'commonName', value: 'localhost' }];
const pems = selfsigned.generate(attrs, { days: 365 });

fs.writeFileSync(path.join(__dirname, 'certs', 'cert.pem'), pems.cert);
fs.writeFileSync(path.join(__dirname, 'certs', 'key.pem'), pems.private);

console.log('Certificados gerados em /certs/');
