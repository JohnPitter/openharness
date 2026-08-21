//go:build !windows

package sidecar

import "os/exec"

func hideConsole(cmd *exec.Cmd) {}

func killSidecarNodes(root string) {}
