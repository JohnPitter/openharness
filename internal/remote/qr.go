package remote

import qrcode "github.com/skip2/go-qrcode"

func encodeQR(content string) ([]byte, error) {
	return qrcode.Encode(content, qrcode.Medium, 256)
}
