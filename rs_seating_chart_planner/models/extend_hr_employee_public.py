# -*- coding: utf-8 -*-

from odoo import fields, models


class HrEmployeePublic(models.Model):
    _inherit = 'hr.employee.public'

    rs_employee_dpto = fields.Selection(
        selection=[
            ('001', '001 - Sales'),
            ('002', '002 - Marketing'),
            ('003', '003 - IT'),
            ('004', '004 - HR'),
            ('005', '005 - Finance'),
        ],
        string='Mitarbeiternummer',
        help='Employee number for identification and reporting',
        compute='_compute_rs_seating_employee_public_fields',
        compute_sudo=True,
        readonly=True,
    )
    rs_employee_number = fields.Char(
        string='Mitarbeiternummer',
        help='Employee number for identification and reporting',
        compute='_compute_rs_seating_employee_public_fields',
        compute_sudo=True,
        readonly=True,
    )

    def _compute_rs_seating_employee_public_fields(self):
        for employee_public in self:
            employee = employee_public.employee_id.sudo()
            employee_public.rs_employee_dpto = (
                employee.rs_employee_dpto
                if employee and 'rs_employee_dpto' in employee._fields
                else False
            )
            employee_public.rs_employee_number = (
                employee.rs_employee_number
                if employee and 'rs_employee_number' in employee._fields
                else False
            )
