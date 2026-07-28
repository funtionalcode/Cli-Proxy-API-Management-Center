---
title: 模型价格与成本估算
description: 配置 CPA Manager Plus 模型价格、service tier、长上下文倍率及 cache read/write/creation 计费，用于请求监控和用量分析的本地成本估算。
---

# 模型价格与成本估算

模型价格页面维护 CPAMP 的本地成本估算规则。它影响 Dashboard、请求监控和用量分析中的成本，不会修改 Provider 账单或 CPA 路由。

打开[模型价格演示](https://seakee.github.io/CPA-Manager-Plus/#/demo/model-prices)可以查看虚构价格和模型调用统计。

## 价格来源

- 从 LiteLLM 或 OpenRouter 主动同步的公开元数据。
- 用户手动添加或覆盖的本地价格。
- 为模型别名、内部名称或 Provider 特定变体维护的条目。

同步只在用户主动触发时发生，可能使用当前 Manager Server 代理设置。

## 当前支持的计费语义

价格结构可能包括：

- 输入与输出 Token。
- Reasoning Token。
- Cache read、cache write 和 cache creation。
- 请求级固定费用。
- `service_tier` 差异。
- 长上下文阈值和倍率。
- 模型别名与 billing model 映射。

例如 GPT-5.6 及类似模型可能根据上下文长度、service tier 和缓存类型采用不同价格。只有请求事件带有对应字段且价格规则存在时，CPAMP 才能正确计算。

## 模型名称匹配

客户端请求名、CPA 路由别名、Provider 实际模型名和价格表名称可能不同。排查成本为空时：

1. 在[请求监控](./monitoring.md)查看事件中的模型和 billing model。
2. 在模型价格页搜索同名条目。
3. 必要时增加本地别名或价格覆盖。
4. 回到[用量分析](./usage-analytics.md)刷新。

## 使用统计

模型价格页使用轻量的模型调用汇总判断哪些价格正在被使用，不会为了展示调用次数下载完整请求历史。

## 准确性边界

- Provider 账单是最终依据。
- 缺失 Token、service tier、长上下文或缓存字段会降低估算精度。
- 包月、赠送额度、阶梯价和多币种不一定能由单一价格条目完整表达。
- 更新价格后，历史成本可能按当前价格重新展示；价格表不是不可变账单快照。
