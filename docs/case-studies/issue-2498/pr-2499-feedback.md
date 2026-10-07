Or may be it actually worked as expected as one out of memory event may have killed multiple tasks at once. See https://github.com/link-foundation/meta-language/pull/196#issuecomment-5985077141

We also must make sure that on recovery from out of memory even we don't do it all at the same time and have some random interval from 30 to 90 seconds, so we reduce probability everything will come rushing access all the same resources at once.

May be we should also update to the latest versions of all dependencies + check that https://github.com/link-foundation/start has exactly all the features we need.
