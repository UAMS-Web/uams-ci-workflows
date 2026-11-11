<?php

use Scratch\Calc;

covers(Calc::class);

it('adds', function () {
    expect((new Calc())->add(2, 3))->toBe(5);
});
