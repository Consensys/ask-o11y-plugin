package skills

import "gopkg.in/yaml.v3"

// yamlUnmarshal is a thin wrapper so the YAML implementation is a single
// import site in this package.
func yamlUnmarshal(data []byte, out interface{}) error {
	return yaml.Unmarshal(data, out)
}
