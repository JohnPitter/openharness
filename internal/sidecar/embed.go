//go:build !noembed

package sidecar

import _ "embed"

//go:embed assets/node.exe
var nodeExe []byte

//go:embed assets/dsh-runtime.zip
var runtimeZip []byte
