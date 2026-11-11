/* global console */
// Which malformed credential files make JSON.parse quote the token in its message?
const gho = ['gho_', 'Ab3Cd5Ef7Gh9Ij1Kl3Mn', '5Op7Qr9St1Uv3Wx5Yz'].join('');
for (const input of [`accessToken=${gho}`, `${gho}`, `{"a":${gho}}`, `{"accessToken":"${gho}"}x`]) {
  try {
    JSON.parse(input);
  } catch (e) {
    console.log(e.message.includes(gho), JSON.stringify(e.message.replace(gho, '<TOKEN>')));
  }
}
