**CronDelete 清掉待发 job**（若机制是 CronCreate 这类会重复 fire 的），免得它在已无事可 reconcile 时反复把你叫醒（白烧拍）；
