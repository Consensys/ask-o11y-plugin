---
name: analyzing-cloudwatch
description: >-
  Queries AWS CloudWatch metrics through Grafana CloudWatch datasources —
  discovering namespaces, metrics, dimensions, and running metric queries.
  Use when the user asks about AWS resources such as EC2, ECS, RDS, Lambda,
  or Container Insights, or mentions CloudWatch or AWS.
metadata:
  version: "1.0"
---

## CloudWatch query workflow

The CloudWatch tools are metadata-driven: **discover before querying**, always in this order:

1. `list_cloudwatch_namespaces` — requires the CloudWatch datasource UID and the AWS `region` (e.g., `us-east-1`). Returns namespaces such as `AWS/EC2`, `AWS/ECS`, `AWS/RDS`, `AWS/Lambda`, `ECS/ContainerInsights`.
2. `list_cloudwatch_metrics` — metric names available in a namespace.
3. `list_cloudwatch_dimensions` — valid dimension keys for a metric (e.g., ECS: `ClusterName`, `ServiceName`; EC2: `InstanceId`).
4. `list_cloudwatch_dimension_values` — valid values for a dimension key; verify values exist before filtering on them.
5. `query_cloudwatch` — the metric query, now with verified namespace, metric, dimensions, and region.

Skipping discovery is the main cause of empty CloudWatch results.

## query_cloudwatch parameters

- Datasource UID, namespace, metric name, region, and dimensions as discovered above
- Time range: `'now-1h'`, RFC3339 (`2026-02-02T19:00:00Z`), or Unix milliseconds
- `accountId` — for cross-account monitoring: a specific source account ID, or `'all'` for all linked accounts (only applicable on a CloudWatch monitoring-account datasource)

## Interpreting empty results

If a query returns nothing, check in order: wrong namespace (re-list), wrong metric name (re-list), dimension mismatch (re-list dimensions and values), wrong region, or a time range with no data (extend with `start="now-6h"`).

## Cross-signal context

CloudWatch metrics rarely stand alone: correlate with application logs and traces where available, and with recent deploys or scaling events in the window. Name the resource (instance, service, cluster) explicitly in the answer — CloudWatch dimensions are the identity of the finding.
