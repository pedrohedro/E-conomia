package handlers

import (
	"fmt"
	"html/template"
)

func templateFuncMap() template.FuncMap {
	return template.FuncMap{
		"map": func(kvs ...any) (map[string]any, error) {
			if len(kvs)%2 != 0 {
				return nil, fmt.Errorf("map requires even number of args")
			}
			m := make(map[string]any, len(kvs)/2)
			for i := 0; i < len(kvs); i += 2 {
				m[fmt.Sprint(kvs[i])] = kvs[i+1]
			}
			return m, nil
		},
	}
}
