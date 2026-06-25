# -*- coding: utf-8 -*-
{
    'name': 'Locations Manager',
    'summary': '''
        Location management module to display and organize locations with
        basic hierarchy support. Allows tracking of location names and their
        parent-child relationships.
        Another awesome module by rising systems AG
        ''',
    'version': '1.0.0',
    'author': 'rising systems AG',
    'license': 'Other proprietary',
    'website': 'https://www.rising-systems.de/r/locationsmanager',
    'support': 'odoo@rising-systems.de',
    'category': 'Productivity',
    'application': True,
    'installable': True,
    'auto_install': False,
    'images': ['static/description/images/store-cover.gif'],
    'depends': ['base', 'mail'],
    'data': [
        'security/ir.model.access.csv',
        'views/location/admin/rs_location_kanban_view.xml',
        'views/location/admin/rs_location_form.xml',
        'views/location/user/rs_location_kanban_view.xml',
        'views/location/user/rs_location_form.xml',
        'views/location/rs_location_list.xml',
        'views/location/rs_location_menu.xml',
    ],
}
