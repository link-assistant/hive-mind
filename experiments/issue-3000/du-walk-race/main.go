// Issue #3000: the continuity fs.DiskUsage walk (copied below, fs/du_unix.go
// at 555e512c) fails when a file disappears mid-walk; the tolerant variant
// skips it. A goroutine churns files the way a compiler does in /tmp.
//
//	cd experiments/issue-3000/du-walk-race && go run . [iterations]
package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"syscall"
)

type usage struct{ inodes, size int64 }

type inode struct{ dev, ino uint64 }

func diskUsage(ctx context.Context, root string, tolerant bool) (usage, error) {
	var size int64
	inodes := map[inode]struct{}{}
	err := filepath.Walk(root, func(path string, fi os.FileInfo, err error) error {
		if err != nil {
			if tolerant && os.IsNotExist(err) && path != root {
				return nil // removed while walking; it no longer uses space
			}
			return err
		}
		stat := fi.Sys().(*syscall.Stat_t)
		key := inode{uint64(stat.Dev), stat.Ino}
		if _, ok := inodes[key]; !ok {
			inodes[key] = struct{}{}
			size += stat.Blocks * 512
		}
		return nil
	})
	return usage{int64(len(inodes)), size}, err
}

func main() {
	iterations := 2000
	if len(os.Args) > 1 {
		iterations, _ = strconv.Atoi(os.Args[1])
	}
	root, _ := os.MkdirTemp("", "du-walk-race-")
	defer os.RemoveAll(root)
	for i := 0; i < 2000; i++ {
		os.WriteFile(filepath.Join(root, "keep"+strconv.Itoa(i)), []byte("x"), 0o644)
	}
	stop := make(chan struct{})
	go func() {
		dir := filepath.Join(root, "cc")
		for {
			select {
			case <-stop:
				return
			default:
			}
			os.MkdirAll(dir, 0o755)
			for i := 0; i < 300; i++ {
				os.WriteFile(filepath.Join(dir, "f"+strconv.Itoa(i)), nil, 0o644)
			}
			os.RemoveAll(dir)
		}
	}()
	for _, tolerant := range []bool{false, true} {
		failed, examples := 0, map[string]int{}
		for i := 0; i < iterations; i++ {
			if _, err := diskUsage(context.Background(), root, tolerant); err != nil {
				failed++
				msg := err.Error()
				if pe, ok := err.(*os.PathError); ok {
					msg = pe.Op + " <path>: " + pe.Err.Error()
				}
				examples[msg]++
			}
		}
		name := "continuity v0.5.0 walk"
		if tolerant {
			name = "skip-ENOENT walk"
		}
		fmt.Printf("%-24s failed %d/%d %v\n", name+":", failed, iterations, examples)
	}
	close(stop)
	if _, err := diskUsage(context.Background(), filepath.Join(root, "missing"), true); err != nil {
		fmt.Println("missing root still fails:", err != nil)
	}
}
