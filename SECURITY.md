# Security Policy

## Supported Versions

We release patches for security vulnerabilities in the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

We take the security of Ask O11y seriously. If you discover a security vulnerability, please follow these steps:

### Private Disclosure Process

**DO NOT** create a public GitHub issue for security vulnerabilities.

1. **Report via GitHub Security Advisory**
   - Go to the [Security tab](https://github.com/Consensys/ask-o11y-plugin/security) of this repository
   - Click "Report a vulnerability"
   - Fill out the vulnerability report form with:
     - Description of the vulnerability
     - Steps to reproduce
     - Potential impact
     - Suggested fix (if any)

2. **What to Include in Your Report**
   - Type of vulnerability (e.g., XSS, SQL injection, authentication bypass)
   - Full paths of source files related to the vulnerability
   - Location of the affected source code (tag/branch/commit or direct URL)
   - Step-by-step instructions to reproduce the issue
   - Proof-of-concept or exploit code (if possible)
   - Impact of the issue, including how an attacker might exploit it

3. **What to Expect**
   - **Initial Response**: Within 48 hours, we will acknowledge receipt of your report
   - **Status Updates**: We will keep you informed of our progress
   - **Validation**: Within 7 days, we will validate the vulnerability
   - **Fix Development**: We will work on a fix and keep you updated on progress
   - **Disclosure**: Once a fix is released, we will publicly disclose the vulnerability

### Response Timeline

- **48 hours**: Initial acknowledgment
- **7 days**: Validation and initial assessment
- **30 days**: Target for fix development and release
- **90 days**: Public disclosure (coordinated with you)

### Security Update Distribution

When security updates are released:

1. **GitHub Release**: Security fixes are documented in release notes
2. **Security Advisory**: Published on GitHub Security Advisories
3. **Changelog**: Included in CHANGELOG.md with CVE reference (if applicable)
4. **NPM/Plugin Registry**: Updated package published

### Scope

This security policy applies to:

- The Ask O11y Grafana plugin (frontend and backend)
- MCP server integrations
- Configuration and deployment examples

### Out of Scope

The following are generally not considered security vulnerabilities:

- Issues requiring physical access to a user's device
- Issues in third-party dependencies (please report to the dependency maintainer)
- Social engineering attacks
- Issues that require user to install malicious plugins or extensions
- Denial of service attacks that require significant resources

### Safe Harbor

We support safe harbor for security researchers who:

- Make a good faith effort to avoid privacy violations, data destruction, and service interruption
- Only interact with accounts you own or with explicit permission from the account holder
- Do not exploit a security issue beyond what is necessary to demonstrate it

## Security Best Practices

When using Ask O11y:

### For Administrators

1. **Access Control**
   - Limit plugin access to trusted users
   - Use Grafana's role-based access control (RBAC) appropriately
   - Review user permissions regularly

2. **MCP Server Security**
   - Run MCP servers in isolated environments
   - Use authentication for MCP server connections
   - Encrypt MCP server communication (TLS/HTTPS)
   - Regularly update MCP server dependencies

3. **API Keys and Secrets**
   - Store API keys securely (use Grafana's provisioning or secrets management)
   - Rotate credentials regularly
   - Never commit secrets to version control

4. **Network Security**
   - Deploy MCP servers in private networks when possible
   - Use firewalls to restrict access
   - Monitor network traffic for anomalies

### For Developers

1. **Code Security**
   - Follow secure coding practices
   - Validate all user inputs
   - Sanitize outputs to prevent XSS
   - Use prepared statements to prevent injection attacks

2. **Dependency Management**
   - Keep dependencies up to date
   - Review security advisories for dependencies
   - Use `npm audit` and Dependabot alerts

3. **Testing**
   - Include security tests in your test suite
   - Test with different user roles (Admin, Editor, Viewer)
   - Validate RBAC enforcement

## Security Features

Ask O11y includes the following security features:

- **Role-Based Access Control (RBAC)**: Tools are restricted based on Grafana user roles
- **Input Validation**: User inputs are validated and sanitized
- **Secure Communication**: MCP servers support HTTPS/TLS
- **Session Management**: Uses Grafana's session management
- **Audit Logging**: Actions are logged through Grafana's audit system

## Acknowledgments

We thank the following security researchers for responsibly disclosing vulnerabilities:

- (No vulnerabilities disclosed yet)

## Contact

For non-security issues, please use:
- **GitHub Issues**: https://github.com/Consensys/ask-o11y-plugin/issues
- **GitHub Discussions**: https://github.com/Consensys/ask-o11y-plugin/discussions

For security-related concerns that don't constitute a vulnerability, you can reach out via GitHub Discussions.

---

**Last Updated**: January 2026
