Task 自带素材示例。修改 seed.json、dataset.json、catalog.json 和 assets/ 后，在运行包根目录执行：

```sh
node core/data-cli.cjs pack mail apps/mail/examples/task-data apps/mail/examples/task-load.json
```

通过 Infra 的 env.load_seed 装入；增加 expected_version 与唯一 request_id。Agent 没有这个入口。
