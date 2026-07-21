package openapi

import (
	_ "embed"
	"encoding/json"
)

//go:embed openapi.json
var specJSON []byte

func GetSpec() (map[string]interface{}, error) {
	var spec map[string]interface{}
	if err := json.Unmarshal(specJSON, &spec); err != nil {
		return nil, err
	}
	return spec, nil
}

func GetSpecBytes() []byte {
	return specJSON
}
